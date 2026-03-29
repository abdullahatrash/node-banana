import { NextRequest, NextResponse } from "next/server";
import { isDatabaseConfigured } from "@/lib/db";
import { assetTypeEnum } from "@/lib/db/schema";
import {
  buildAssetObjectKey,
  canUseS3Storage,
  createPresignedDownload,
  putObjectToS3,
} from "@/lib/storage";
import { authorizeStudioRequest, authzErrorResponse } from "@/lib/studio/authz";
import {
  finalizeAssetUpload,
  getProject,
  recordPendingS3AssetWithQuota,
  StudioAssetQuotaExceededError,
} from "@/lib/studio/repository";

interface IngestRequest {
  projectId?: string | null;
  assetType: (typeof assetTypeEnum.enumValues)[number];
  sourceDataUrl?: string;
  sourceUrl?: string;
  fileName?: string;
  contentType?: string;
}

interface IngestResponse {
  success: boolean;
  assetId?: string;
  key?: string;
  downloadUrl?: string;
  expiresInSeconds?: number;
  error?: string;
}

const MAX_INGEST_BYTES = 500 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 60_000;

function pickDefaultMimeType(assetType: IngestRequest["assetType"]): string {
  if (assetType === "video") return "video/mp4";
  if (assetType === "audio") return "audio/mpeg";
  if (assetType === "model3d") return "model/gltf-binary";
  return "image/png";
}

function getExtensionForMimeType(mimeType: string, fallback = "bin"): string {
  const normalized = mimeType.toLowerCase().trim();
  const map: Record<string, string> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/gif": "gif",
    "image/webp": "webp",
    "image/svg+xml": "svg",
    "video/mp4": "mp4",
    "video/webm": "webm",
    "video/quicktime": "mov",
    "audio/mpeg": "mp3",
    "audio/wav": "wav",
    "audio/ogg": "ogg",
    "audio/flac": "flac",
    "audio/aac": "aac",
    "model/gltf-binary": "glb",
    "model/gltf+json": "gltf",
    "model/obj": "obj",
    "model/vnd.usdz+zip": "usdz",
    "model/fbx": "fbx",
    "model/stl": "stl",
  };

  return map[normalized] || fallback;
}

function getExtensionFromFileName(fileName?: string): string | null {
  if (!fileName) return null;
  const parts = fileName.split(".");
  if (parts.length < 2) return null;
  const ext = parts[parts.length - 1]?.toLowerCase().replace(/[^a-z0-9]/g, "");
  return ext || null;
}

function parseDataUrl(sourceDataUrl: string): { mimeType: string; bytes: Buffer } {
  const match = sourceDataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) {
    throw new Error("sourceDataUrl must be a valid base64 data URL.");
  }

  const mimeType = match[1].trim().toLowerCase();
  const base64Data = match[2];
  const bytes = Buffer.from(base64Data, "base64");
  return { mimeType, bytes };
}

function sanitizeFileName(fileName?: string): string | null {
  if (!fileName) return null;
  const trimmed = fileName.trim();
  if (!trimmed) return null;
  return trimmed.replace(/[^a-zA-Z0-9._-]/g, "_");
}

async function fetchRemoteBytes(sourceUrl: string): Promise<{ mimeType: string | null; bytes: Buffer }> {
  let parsed: URL;
  try {
    parsed = new URL(sourceUrl);
  } catch {
    throw new Error("sourceUrl must be a valid URL.");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("sourceUrl must use http or https.");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(sourceUrl, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`Failed to fetch sourceUrl: HTTP ${response.status}`);
    }

    const contentLength = response.headers.get("content-length");
    if (contentLength) {
      const length = Number(contentLength);
      if (Number.isFinite(length) && length > MAX_INGEST_BYTES) {
        throw new Error(`Source size exceeds ${MAX_INGEST_BYTES} bytes.`);
      }
    }

    const arrayBuffer = await response.arrayBuffer();
    if (arrayBuffer.byteLength > MAX_INGEST_BYTES) {
      throw new Error(`Source size exceeds ${MAX_INGEST_BYTES} bytes.`);
    }

    const contentType = response.headers.get("content-type");
    const mimeType = contentType ? contentType.split(";")[0].trim().toLowerCase() : null;

    return {
      mimeType,
      bytes: Buffer.from(arrayBuffer),
    };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error(`sourceUrl fetch timed out after ${FETCH_TIMEOUT_MS}ms.`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function POST(
  request: NextRequest,
): Promise<NextResponse<IngestResponse>> {
  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      {
        success: false,
        error:
          "DATABASE_URL is not configured. Configure Postgres to use asset metadata APIs.",
      },
      { status: 503 },
    );
  }

  if (!canUseS3Storage()) {
    return NextResponse.json(
      {
        success: false,
        error:
          "S3 storage is not configured. Set STORAGE_BACKEND=s3 and required S3_* environment variables.",
      },
      { status: 400 },
    );
  }

  let createdAssetId: string | null = null;
  let workspaceId: string | null = null;
  let uploadMimeType: string | null = null;

  try {
    const body = (await request.json()) as IngestRequest;

    if (!assetTypeEnum.enumValues.includes(body.assetType)) {
      return NextResponse.json(
        {
          success: false,
          error: `Unsupported asset type: ${body.assetType}`,
        },
        { status: 400 },
      );
    }

    const hasDataUrl = typeof body.sourceDataUrl === "string" && body.sourceDataUrl.trim().length > 0;
    const hasSourceUrl = typeof body.sourceUrl === "string" && body.sourceUrl.trim().length > 0;

    if (hasDataUrl === hasSourceUrl) {
      return NextResponse.json(
        {
          success: false,
          error: "Exactly one of sourceDataUrl or sourceUrl is required.",
        },
        { status: 400 },
      );
    }

    const authz = await authorizeStudioRequest(request, {
      route: "/api/studio/assets/ingest",
      action: "write",
    });
    if (!authz.authorized) {
      return authzErrorResponse(authz);
    }

    workspaceId = authz.workspaceId;

    const projectId = body.projectId?.trim() || null;
    if (projectId) {
      const project = await getProject(authz.workspaceId, projectId);
      if (!project) {
        return NextResponse.json(
          {
            success: false,
            error: "No access to this project.",
          },
          { status: 403 },
        );
      }
    }

    let bytes: Buffer;
    let sourceMimeType: string | null;

    if (hasDataUrl) {
      const parsed = parseDataUrl(body.sourceDataUrl!);
      bytes = parsed.bytes;
      sourceMimeType = parsed.mimeType;
    } else {
      const fetched = await fetchRemoteBytes(body.sourceUrl!.trim());
      bytes = fetched.bytes;
      sourceMimeType = fetched.mimeType;
    }

    if (bytes.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: "Source content is empty.",
        },
        { status: 400 },
      );
    }

    if (bytes.length > MAX_INGEST_BYTES) {
      return NextResponse.json(
        {
          success: false,
          error: `Source size exceeds ${MAX_INGEST_BYTES} bytes.`,
        },
        { status: 413 },
      );
    }

    uploadMimeType = (body.contentType?.trim().toLowerCase() || sourceMimeType || pickDefaultMimeType(body.assetType));
    const sanitizedName = sanitizeFileName(body.fileName);
    const extension =
      getExtensionFromFileName(sanitizedName || undefined) ||
      getExtensionForMimeType(uploadMimeType, "bin");

    const key = buildAssetObjectKey({
      workspaceId: authz.workspaceId,
      projectId,
      assetType: body.assetType,
      fileExtension: extension,
    });

    const pending = await recordPendingS3AssetWithQuota({
      workspaceId: authz.workspaceId,
      userId: authz.userId,
      projectId,
      type: body.assetType,
      storageBucket: process.env.S3_BUCKET_NAME || null,
      storageKey: key,
      mimeType: uploadMimeType,
      originalFileName: sanitizedName,
      expectedSizeBytes: bytes.length,
    });
    createdAssetId = pending.id;

    await putObjectToS3({
      key,
      body: bytes,
      contentType: uploadMimeType,
    });

    await finalizeAssetUpload({
      workspaceId: authz.workspaceId,
      assetId: pending.id,
      uploadState: "ready",
      sizeBytes: bytes.length,
      mimeType: uploadMimeType,
    });

    const signed = await createPresignedDownload({ key });

    return NextResponse.json({
      success: true,
      assetId: pending.id,
      key,
      downloadUrl: signed.downloadUrl,
      expiresInSeconds: signed.expiresInSeconds,
    });
  } catch (error) {
    if (error instanceof StudioAssetQuotaExceededError) {
      return NextResponse.json(
        {
          success: false,
          error: "Workspace storage quota exceeded.",
        },
        { status: 403 },
      );
    }

    if (workspaceId && createdAssetId) {
      try {
        await finalizeAssetUpload({
          workspaceId,
          assetId: createdAssetId,
          uploadState: "failed",
          mimeType: uploadMimeType || undefined,
          error: error instanceof Error ? error.message : "Asset ingest failed",
        });
      } catch {
        // best-effort failure finalization
      }
    }

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to ingest asset",
      },
      { status: 500 },
    );
  }
}
