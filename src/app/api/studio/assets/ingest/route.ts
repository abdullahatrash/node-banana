import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { noStoreJson } from "@/lib/agent-auth/http-request";
import { assetTypeEnum } from "@/lib/db/schema";
import {
  buildAssetObjectKey,
  canUseS3Storage,
  createPresignedDownload,
  putObjectToS3,
  streamUploadToS3,
} from "@/lib/storage";
import { fetchPublicRemoteFile } from "@/lib/security/remote-file-fetch";
import {
  finalizeAssetUpload,
  getProject,
  recordPendingS3AssetWithQuota,
  StudioAssetQuotaExceededError,
} from "@/lib/studio/repository";
import { withStudioAuth } from "@/lib/studio/withStudioAuth";
import { GOVERNANCE_REGION_ROUTES, requireGovernanceRegionRoute } from "@/lib/governance/region-enforcement";

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
  code?: "ASSET_INGEST_FAILED";
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

async function probeUploadedMedia(assetType: IngestRequest["assetType"], bytes: Buffer): Promise<{ checksum: `sha256:${string}`; width?: number; height?: number; durationSeconds?: number; metadata?: Record<string, unknown> }> {
  const checksum = `sha256:${createHash("sha256").update(bytes).digest("hex")}` as const;
  if (assetType === "image") {
    const result = await sharp(bytes, { failOn: "error" }).metadata();
    if (!result.width || !result.height) throw new Error("Uploaded image dimensions could not be decoded.");
    return { checksum, width: result.width, height: result.height, metadata: { dimensionEvidence: "server-media-probe/v1" } };
  }
  if (assetType === "video") {
    const { ALL_FORMATS, BlobSource, Input } = await import("mediabunny");
    const media = new Input({ formats: ALL_FORMATS, source: new BlobSource(new Blob([new Uint8Array(bytes)])) });
    try {
      const track = await media.getPrimaryVideoTrack();
      const durationSeconds = await media.computeDuration();
      if (!track || !track.displayWidth || !track.displayHeight || !Number.isFinite(durationSeconds) || durationSeconds <= 0) throw new Error("Uploaded video metadata could not be decoded.");
      return { checksum, width: track.displayWidth, height: track.displayHeight, durationSeconds, metadata: { dimensionEvidence: "server-media-probe/v1" } };
    } finally { media.dispose(); }
  }
  return { checksum };
}

function sanitizeFileName(fileName?: string): string | null {
  if (!fileName) return null;
  const trimmed = fileName.trim();
  if (!trimmed) return null;
  return trimmed.replace(/[^a-zA-Z0-9._-]/g, "_");
}

export const POST = withStudioAuth<undefined>(
  { route: "/api/studio/assets/ingest", action: "write" },
  async (request: NextRequest, authz): Promise<NextResponse<IngestResponse>> => {
    if (!canUseS3Storage()) {
      return noStoreJson(
        {
          success: false,
          error:
            "S3 storage is not configured. Set STORAGE_BACKEND=s3 and required S3_* environment variables.",
        },
        { status: 400 },
      );
    }

    await requireGovernanceRegionRoute({
      workspaceId: authz.workspaceId,
      route: GOVERNANCE_REGION_ROUTES.assetStorage,
      configuredRegion: process.env.S3_REGION ?? process.env.APP_DATA_REGION,
    });
    await requireGovernanceRegionRoute({
      workspaceId: authz.workspaceId,
      route: GOVERNANCE_REGION_ROUTES.assetProcessing,
      configuredRegion: process.env.ASSET_PROCESSING_REGION ?? process.env.APP_DATA_REGION,
    });

    let createdAssetId: string | null = null;
    let uploadMimeType: string | null = null;

    try {
      const body = (await request.json()) as IngestRequest;

      if (!assetTypeEnum.enumValues.includes(body.assetType)) {
        return noStoreJson(
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
        return noStoreJson(
          {
            success: false,
            error: "Exactly one of sourceDataUrl or sourceUrl is required.",
          },
          { status: 400 },
        );
      }

      const projectId = body.projectId?.trim() || null;
      if (projectId) {
        const project = await getProject(authz.workspaceId, projectId);
        if (!project) {
          return noStoreJson(
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
          return noStoreJson(
            { success: false, error: "Source content is empty." },
            { status: 400 },
          );
        }

        if (bytes.length > MAX_INGEST_BYTES) {
          return noStoreJson(
            { success: false, error: `Source size exceeds ${MAX_INGEST_BYTES} bytes.` },
            { status: 413 },
          );
        }

        uploadMimeType = (body.contentType?.trim().toLowerCase() || sourceMimeType || pickDefaultMimeType(body.assetType));
        if (body.assetType === "image" && !uploadMimeType.startsWith("image/")) throw new Error("Uploaded image content type is invalid.");
        if (body.assetType === "video" && !["video/mp4", "video/webm", "video/quicktime"].includes(uploadMimeType)) throw new Error("Uploaded video format is unsupported.");
        const probed = await probeUploadedMedia(body.assetType, bytes);
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
          checksum: probed.checksum,
          width: probed.width,
          height: probed.height,
          durationSeconds: probed.durationSeconds,
          metadata: probed.metadata,
        });

        const signed = await createPresignedDownload({ key });
        return noStoreJson({
          success: true,
          assetId: pending.id,
          key,
          downloadUrl: signed.downloadUrl,
          expiresInSeconds: signed.expiresInSeconds,
        });
      }

      // Remote URL path: stream directly to S3 without buffering
      const fetched = await fetchPublicRemoteFile({ sourceUrl: body.sourceUrl!.trim(), maximumBytes: MAX_INGEST_BYTES, timeoutMs: FETCH_TIMEOUT_MS });
      const sourceMimeType = fetched.mimeType;
      try {
        uploadMimeType = (body.contentType?.trim().toLowerCase() || sourceMimeType || pickDefaultMimeType(body.assetType));
        const sanitizedName = sanitizeFileName(body.fileName);
        const extension = getExtensionFromFileName(sanitizedName || undefined) || getExtensionForMimeType(uploadMimeType, "bin");
        const key = buildAssetObjectKey({ workspaceId: authz.workspaceId, projectId, assetType: body.assetType, fileExtension: extension });
        const pending = await recordPendingS3AssetWithQuota({ workspaceId: authz.workspaceId, userId: authz.userId, projectId, type: body.assetType, storageBucket: process.env.S3_BUCKET_NAME || null, storageKey: key, mimeType: uploadMimeType, originalFileName: sanitizedName, expectedSizeBytes: fetched.sizeBytes });
        createdAssetId = pending.id;
        const { sizeBytes } = await streamUploadToS3({ key, body: fetched.createReadStream(), contentType: uploadMimeType, contentLength: fetched.sizeBytes });
        if (sizeBytes !== fetched.sizeBytes) throw new Error("Remote asset upload size mismatch.");
        await finalizeAssetUpload({ workspaceId: authz.workspaceId, assetId: pending.id, uploadState: "ready", sizeBytes, mimeType: uploadMimeType });
        const signed = await createPresignedDownload({ key });
        return noStoreJson({ success: true, assetId: pending.id, key, downloadUrl: signed.downloadUrl, expiresInSeconds: signed.expiresInSeconds });
      } finally {
        await fetched.cleanup();
      }
    } catch (error) {
      if (error instanceof StudioAssetQuotaExceededError) {
        return noStoreJson(
          {
            success: false,
            error: "Workspace storage quota exceeded.",
          },
          { status: 403 },
        );
      }

      if (createdAssetId) {
        try {
          await finalizeAssetUpload({
            workspaceId: authz.workspaceId,
            assetId: createdAssetId,
            uploadState: "failed",
            mimeType: uploadMimeType || undefined,
            error: "ASSET_INGEST_FAILED",
          });
        } catch {
          // best-effort failure finalization
        }
      }

      return noStoreJson(
        {
          success: false,
          code: "ASSET_INGEST_FAILED",
          error: "Asset ingest failed.",
        },
        { status: 500 },
      );
    }
  },
);
