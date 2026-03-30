import { NextRequest, NextResponse } from "next/server";
import { isDatabaseConfigured } from "@/lib/db";
import { assetTypeEnum } from "@/lib/db/schema";
import {
  buildAssetObjectKey,
  canUseS3Storage,
  createPresignedDownload,
  deleteObjectFromS3,
  putObjectToS3,
  streamUploadToS3,
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

async function fetchRemoteStream(sourceUrl: string): Promise<{
  mimeType: string | null;
  body: ReadableStream<Uint8Array>;
  contentLength: number | null;
}> {
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

    const contentLengthHeader = response.headers.get("content-length");
    let contentLength: number | null = null;
    if (contentLengthHeader) {
      const length = Number(contentLengthHeader);
      if (Number.isFinite(length)) {
        if (length > MAX_INGEST_BYTES) {
          throw new Error(`Source size exceeds ${MAX_INGEST_BYTES} bytes.`);
        }
        contentLength = length;
      }
    }

    const contentType = response.headers.get("content-type");
    const mimeType = contentType ? contentType.split(";")[0].trim().toLowerCase() : null;

    if (!response.body) {
      throw new Error("sourceUrl response has no body.");
    }

    return {
      mimeType,
      body: response.body,
      contentLength,
    };
  } catch (error) {
    clearTimeout(timeout);
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error(`sourceUrl fetch timed out after ${FETCH_TIMEOUT_MS}ms.`);
    }
    throw error;
  }
  // Note: timeout is NOT cleared here — it stays active during streaming
  // to enforce the overall fetch timeout for the stream consumption.
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

    if (hasDataUrl) {
      // Data URL path: already in memory, use direct putObject
      const parsed = parseDataUrl(body.sourceDataUrl!);
      const bytes = parsed.bytes;
      const sourceMimeType = parsed.mimeType;

      if (bytes.length === 0) {
        return NextResponse.json(
          { success: false, error: "Source content is empty." },
          { status: 400 },
        );
      }

      if (bytes.length > MAX_INGEST_BYTES) {
        return NextResponse.json(
          { success: false, error: `Source size exceeds ${MAX_INGEST_BYTES} bytes.` },
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

      await putObjectToS3({ key, body: bytes, contentType: uploadMimeType });

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
    }

    // Remote URL path: stream directly to S3 without buffering
    const fetched = await fetchRemoteStream(body.sourceUrl!.trim());
    const sourceMimeType = fetched.mimeType;

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

    // Use content-length for quota if available, otherwise reserve max
    const expectedSizeBytes = fetched.contentLength ?? MAX_INGEST_BYTES;

    const pending = await recordPendingS3AssetWithQuota({
      workspaceId: authz.workspaceId,
      userId: authz.userId,
      projectId,
      type: body.assetType,
      storageBucket: process.env.S3_BUCKET_NAME || null,
      storageKey: key,
      mimeType: uploadMimeType,
      originalFileName: sanitizedName,
      expectedSizeBytes,
    });
    createdAssetId = pending.id;

    const { sizeBytes } = await streamUploadToS3({
      key,
      body: fetched.body,
      contentType: uploadMimeType,
      contentLength: fetched.contentLength ?? undefined,
    });

    if (sizeBytes === 0) {
      await deleteObjectFromS3({ key }).catch(() => {});
      await finalizeAssetUpload({
        workspaceId: authz.workspaceId,
        assetId: pending.id,
        uploadState: "failed",
        error: "Source content is empty.",
      });
      return NextResponse.json(
        { success: false, error: "Source content is empty." },
        { status: 400 },
      );
    }

    if (sizeBytes > MAX_INGEST_BYTES) {
      await deleteObjectFromS3({ key }).catch(() => {});
      await finalizeAssetUpload({
        workspaceId: authz.workspaceId,
        assetId: pending.id,
        uploadState: "failed",
        error: `Source size exceeds ${MAX_INGEST_BYTES} bytes.`,
      });
      return NextResponse.json(
        { success: false, error: `Source size exceeds ${MAX_INGEST_BYTES} bytes.` },
        { status: 413 },
      );
    }

    await finalizeAssetUpload({
      workspaceId: authz.workspaceId,
      assetId: pending.id,
      uploadState: "ready",
      sizeBytes,
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
