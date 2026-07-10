import { z } from "zod";

import { buildCdnDownloadUrl, createPresignedDownload } from "@/lib/storage";
import { getAsset } from "@/lib/studio/repository";

import { ToolError } from "../errors";
import type { ToolDefinition } from "../types";

const inputSchema = z.object({
  assetId: z.string(),
});

const outputSchema = z.object({
  assetId: z.string(),
  downloadUrl: z.string(),
  expiresInSeconds: z.number().nullable().optional(),
});

/** Mirrors the studio download route's readiness check: an asset with no
 * metadata (pre-quota assets) is treated as ready; only an explicit
 * pending/failed upload state blocks a download url. */
function isAssetReady(metadata: unknown): boolean {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return true;
  }

  const uploadState = (metadata as Record<string, unknown>).uploadState;
  if (uploadState === "failed") return false;
  if (uploadState === "pending") return false;
  return true;
}

/**
 * Get a download URL for an asset already in this workspace — a CDN url when
 * `CDN_BASE_URL` is configured, otherwise a short-lived S3/R2 presigned url,
 * exactly as `/api/studio/assets/[assetId]/download` resolves it. Use after
 * `upload_asset` or `list_assets` to fetch or share the underlying media.
 */
export const getAssetDownloadUrlTool: ToolDefinition<
  typeof inputSchema,
  typeof outputSchema
> = {
  name: "get_asset_download_url",
  description:
    "Get a download URL (CDN or presigned) for an asset id already in this workspace.",
  requiredPermission: "assets:read",
  inputSchema,
  outputSchema,
  handler: async (input, ctx) => {
    const asset = await getAsset(ctx.session.workspace.id, input.assetId);
    if (!asset) {
      throw new ToolError({
        code: "not_found",
        message: "Asset not found.",
        fix: "Check the asset id, or call list_assets to find a valid one.",
      });
    }

    if (asset.storageProvider !== "s3") {
      throw new ToolError({
        code: "invalid_input",
        message: "Asset is not stored in S3/R2.",
        fix: "This asset predates cloud storage and has no downloadable URL.",
      });
    }

    if (!asset.storageKey?.trim()) {
      throw new ToolError({
        code: "invalid_input",
        message: "Asset has no storage key.",
        fix: "This asset record is incomplete and cannot be downloaded.",
      });
    }

    if (!isAssetReady(asset.metadata)) {
      throw new ToolError({
        code: "invalid_input",
        message: "Asset upload is not ready.",
        fix: "Wait for the upload to finish, or re-upload if it failed.",
      });
    }

    const cdnUrl = buildCdnDownloadUrl({ key: asset.storageKey });
    if (cdnUrl) {
      return { assetId: asset.id, downloadUrl: cdnUrl, expiresInSeconds: null };
    }

    const signed = await createPresignedDownload({ key: asset.storageKey });
    return {
      assetId: asset.id,
      downloadUrl: signed.downloadUrl,
      expiresInSeconds: signed.expiresInSeconds,
    };
  },
};
