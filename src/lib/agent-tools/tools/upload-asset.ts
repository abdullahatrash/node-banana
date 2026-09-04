import { z } from "zod";

import {
  buildAssetObjectKey,
  buildCdnDownloadUrl,
  canUseS3Storage,
  createPresignedDownload,
  putObjectToS3,
  streamUploadToS3,
} from "@/lib/storage";
import { fetchPublicRemoteFile } from "@/lib/security/remote-file-fetch";
import { collectBufferedAssetEvidence, collectFileAssetEvidence } from "@/lib/studio/asset-media-evidence";
import {
  getProject,
  finalizeAssetUpload,
  recordPendingS3AssetWithQuota,
  StudioAssetQuotaExceededError,
} from "@/lib/studio/repository";

import { ToolError } from "../errors";
import type { ToolDefinition } from "../types";

const assetTypeSchema = z.enum([
  "image",
  "video",
  "audio",
  "model3d",
  "workflow",
]);

// Kept in sync with /api/studio/assets/ingest's MAX_INGEST_BYTES — the same
// upper bound applies to a streamed sourceUrl regardless of which surface
// uploaded the content.
const MAX_UPLOAD_BYTES = 500 * 1024 * 1024;
// base64Content must live as a single in-memory JS string (a ~500MB file would
// base64-inflate to ~667M UTF-16 code units, over V8's string-length ceiling)
// and is transported inline in a JSON request body, so direct content is
// capped well below the streamed-sourceUrl limit. Larger files should be
// uploaded via sourceUrl instead.
const MAX_BASE64_CONTENT_BYTES = 50 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 60_000;

const inputSchema = z.object({
  assetType: assetTypeSchema,
  projectId: z.string().optional(),
  fileName: z.string().optional(),
  mimeType: z.string().optional(),
  /** Raw file bytes, base64-encoded (no `data:` prefix). */
  base64Content: z.string().optional(),
  /** A URL the server fetches and stores. Exactly one of this or base64Content. */
  sourceUrl: z.string().optional(),
});

const outputSchema = z.object({
  assetId: z.string(),
  downloadUrl: z.string(),
  expiresInSeconds: z.number().nullable().optional(),
});

function pickDefaultMimeType(assetType: z.infer<typeof assetTypeSchema>): string {
  if (assetType === "video") return "video/mp4";
  if (assetType === "audio") return "audio/mpeg";
  if (assetType === "model3d") return "model/gltf-binary";
  return "image/png";
}

const EXTENSION_BY_MIME_TYPE: Record<string, string> = {
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

function getExtensionForMimeType(mimeType: string, fallback = "bin"): string {
  return EXTENSION_BY_MIME_TYPE[mimeType.toLowerCase().trim()] || fallback;
}

function getExtensionFromFileName(fileName?: string | null): string | null {
  if (!fileName) return null;
  const parts = fileName.split(".");
  if (parts.length < 2) return null;
  const ext = parts[parts.length - 1]?.toLowerCase().replace(/[^a-z0-9]/g, "");
  return ext || null;
}

function sanitizeFileName(fileName?: string): string | null {
  if (!fileName) return null;
  const trimmed = fileName.trim();
  if (!trimmed) return null;
  return trimmed.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function decodeBase64(content: string): Buffer {
  const trimmed = content.trim();
  if (!trimmed) {
    throw new ToolError({
      code: "invalid_input",
      message: "base64Content must not be empty.",
      fix: "Provide the file's bytes as a base64-encoded string.",
    });
  }

  // Accept a `data:...;base64,` prefix defensively, but the canonical input is
  // raw base64 with no prefix.
  const match = trimmed.match(/^data:([^;]+);base64,(.+)$/);
  const raw = match ? match[2] : trimmed;

  let bytes: Buffer;
  try {
    bytes = Buffer.from(raw, "base64");
  } catch {
    bytes = Buffer.alloc(0);
  }

  if (bytes.length === 0) {
    throw new ToolError({
      code: "invalid_input",
      message: "base64Content could not be decoded to non-empty bytes.",
      fix: "Confirm the content is valid base64 and not empty.",
    });
  }

  return bytes;
}

async function resolveDownloadUrl(
  key: string,
): Promise<{ downloadUrl: string; expiresInSeconds: number | null }> {
  const cdnUrl = buildCdnDownloadUrl({ key });
  if (cdnUrl) {
    return { downloadUrl: cdnUrl, expiresInSeconds: null };
  }

  const signed = await createPresignedDownload({ key });
  return { downloadUrl: signed.downloadUrl, expiresInSeconds: signed.expiresInSeconds };
}

/**
 * Upload media into the token's workspace — either raw base64 content or a
 * source URL the server fetches — subject to the exact same type and workspace
 * storage-quota rules as the Studio upload UI (`recordPendingS3AssetWithQuota`).
 * Returns the new asset's id and a URL to download it, so an agent can
 * immediately reference the asset (e.g. when composing a post) without a
 * second round trip.
 */
export const uploadAssetTool: ToolDefinition<typeof inputSchema, typeof outputSchema> = {
  name: "upload_asset",
  description:
    "Upload media into this workspace from base64 content or a source URL. Enforces the workspace's storage quota and asset type rules. Returns the new asset id and a download URL.",
  requiredPermission: "assets:write",
  inputSchema,
  outputSchema,
  handler: async (input, ctx) => {
    if (!canUseS3Storage()) {
      throw new ToolError({
        code: "internal",
        message:
          "S3 storage is not configured. Set STORAGE_BACKEND=s3 and required S3_* environment variables.",
        fix: "Ask the workspace operator to configure cloud storage before uploading assets.",
      });
    }

    const hasContent =
      typeof input.base64Content === "string" && input.base64Content.trim().length > 0;
    const hasUrl = typeof input.sourceUrl === "string" && input.sourceUrl.trim().length > 0;

    if (hasContent === hasUrl) {
      throw new ToolError({
        code: "invalid_input",
        message: "Provide exactly one of base64Content or sourceUrl.",
        fix: "Pass either base64Content (with fileName/mimeType) or sourceUrl, not both.",
      });
    }

    const workspaceId = ctx.session.workspace.id;
    const userId = ctx.session.user.id;

    const projectId = input.projectId?.trim() || null;
    if (projectId) {
      const project = await getProject(workspaceId, projectId);
      if (!project) {
        throw new ToolError({
          code: "not_found",
          message: "No access to this project.",
          fix: "Use a projectId that exists in this workspace, or omit it to leave the asset unscoped.",
        });
      }
    }

    let createdAssetId: string | null = null;
    let uploadMimeType: string | null = null;

    try {
      if (hasContent) {
        const bytes = decodeBase64(input.base64Content!);

        if (bytes.length > MAX_BASE64_CONTENT_BYTES) {
          throw new ToolError({
            code: "invalid_input",
            message: `Content exceeds ${MAX_BASE64_CONTENT_BYTES} bytes.`,
            fix: "Upload a smaller file, or use sourceUrl to stream a larger one instead.",
          });
        }

        uploadMimeType =
          input.mimeType?.trim().toLowerCase() || pickDefaultMimeType(input.assetType);
        const evidence = await collectBufferedAssetEvidence({ assetType: input.assetType, mimeType: uploadMimeType, bytes });
        const sanitizedName = sanitizeFileName(input.fileName);
        const extension =
          getExtensionFromFileName(sanitizedName) ||
          getExtensionForMimeType(uploadMimeType, "bin");

        const key = buildAssetObjectKey({
          workspaceId,
          projectId,
          assetType: input.assetType,
          fileExtension: extension,
        });

        const pending = await recordPendingS3AssetWithQuota({
          workspaceId,
          userId,
          projectId,
          type: input.assetType,
          storageBucket: process.env.S3_BUCKET_NAME || null,
          storageKey: key,
          mimeType: uploadMimeType,
          originalFileName: sanitizedName,
          expectedSizeBytes: bytes.length,
        });
        createdAssetId = pending.id;

        await putObjectToS3({ key, body: bytes, contentType: uploadMimeType });

        await finalizeAssetUpload({
          workspaceId,
          assetId: pending.id,
          uploadState: "ready",
          sizeBytes: bytes.length,
          mimeType: uploadMimeType,
          checksum: evidence.checksum,
          width: evidence.width,
          height: evidence.height,
          durationSeconds: evidence.durationSeconds,
          metadata: evidence.metadata,
        });

        const { downloadUrl, expiresInSeconds } = await resolveDownloadUrl(key);
        return { assetId: pending.id, downloadUrl, expiresInSeconds };
      }

      const fetched = await fetchPublicRemoteFile({ sourceUrl: input.sourceUrl!.trim(), maximumBytes: MAX_UPLOAD_BYTES, timeoutMs: FETCH_TIMEOUT_MS });
      try {
        uploadMimeType = input.mimeType?.trim().toLowerCase() || fetched.mimeType || pickDefaultMimeType(input.assetType);
        const evidence = await collectFileAssetEvidence({ assetType: input.assetType, mimeType: uploadMimeType, path: fetched.path, checksum: fetched.digest });
        const sanitizedName = sanitizeFileName(input.fileName);
        const extension = getExtensionFromFileName(sanitizedName) || getExtensionForMimeType(uploadMimeType, "bin");
        const key = buildAssetObjectKey({ workspaceId, projectId, assetType: input.assetType, fileExtension: extension });
        const pending = await recordPendingS3AssetWithQuota({ workspaceId, userId, projectId, type: input.assetType, storageBucket: process.env.S3_BUCKET_NAME || null, storageKey: key, mimeType: uploadMimeType, originalFileName: sanitizedName, expectedSizeBytes: fetched.sizeBytes });
        createdAssetId = pending.id;
        const { sizeBytes } = await streamUploadToS3({ key, body: fetched.createReadStream(), contentType: uploadMimeType, contentLength: fetched.sizeBytes });
        if (sizeBytes !== fetched.sizeBytes) throw new Error("Remote asset upload size mismatch.");
        await finalizeAssetUpload({ workspaceId, assetId: pending.id, uploadState: "ready", sizeBytes, mimeType: uploadMimeType, checksum: evidence.checksum, width: evidence.width, height: evidence.height, durationSeconds: evidence.durationSeconds, metadata: evidence.metadata });
        const { downloadUrl, expiresInSeconds } = await resolveDownloadUrl(key);
        return { assetId: pending.id, downloadUrl, expiresInSeconds };
      } finally {
        await fetched.cleanup();
      }
    } catch (error) {
      if (error instanceof StudioAssetQuotaExceededError) {
        throw new ToolError({
          code: "forbidden",
          message: "Workspace storage quota exceeded.",
          fix: "Delete unused assets or raise the workspace's storage quota before uploading more.",
        });
      }

      if (createdAssetId) {
        await finalizeAssetUpload({
          workspaceId,
          assetId: createdAssetId,
          uploadState: "failed",
          mimeType: uploadMimeType || undefined,
          error: error instanceof Error ? error.message : "Asset upload failed",
        }).catch(() => {});
      }

      throw error;
    }
  },
};
