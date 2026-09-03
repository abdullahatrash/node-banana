import { NextRequest, NextResponse } from "next/server";
import { noStoreJson } from "@/lib/agent-auth/http-request";
import { buildCdnDownloadUrl, canUseS3Storage, createPresignedDownload } from "@/lib/storage";
import { getAsset } from "@/lib/studio/repository";
import { withStudioAuth } from "@/lib/studio/withStudioAuth";
import { GOVERNANCE_REGION_ROUTES, requireGovernanceRegionRoute } from "@/lib/governance/region-enforcement";

interface AssetDownloadResponse {
  success: boolean;
  assetId?: string;
  key?: string;
  downloadUrl?: string;
  expiresInSeconds?: number;
  error?: string;
}

function isAssetReady(metadata: unknown): boolean {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return true;
  }

  const uploadState = (metadata as Record<string, unknown>).uploadState;
  if (uploadState === "failed") return false;
  if (uploadState === "pending") return false;
  return true;
}

type AssetIdContext = { params: Promise<{ assetId: string }> };

export const GET = withStudioAuth<AssetIdContext>(
  { route: "/api/studio/assets/[assetId]/download", action: "read" },
  async (
    _request: NextRequest,
    authz,
    context,
  ): Promise<NextResponse<AssetDownloadResponse>> => {
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

    const { assetId } = await context.params;
    const asset = await getAsset(authz.workspaceId, assetId);
    if (!asset) {
      return noStoreJson(
        {
          success: false,
          error: "Asset not found.",
        },
        { status: 404 },
      );
    }

    if (asset.storageProvider !== "s3") {
      return noStoreJson(
        {
          success: false,
          error: "Asset is not stored in S3/R2.",
        },
        { status: 400 },
      );
    }

    if (!asset.storageKey?.trim()) {
      return noStoreJson(
        {
          success: false,
          error: "Asset has no storage key.",
        },
        { status: 400 },
      );
    }

    if (!isAssetReady(asset.metadata)) {
      return noStoreJson(
        {
          success: false,
          error: "Asset upload is not ready.",
        },
        { status: 409 },
      );
    }

    const cdnUrl = buildCdnDownloadUrl({ key: asset.storageKey });
    if (cdnUrl) {
      return noStoreJson({
        success: true,
        assetId: asset.id,
        key: asset.storageKey,
        downloadUrl: cdnUrl,
      });
    }

    const signed = await createPresignedDownload({
      key: asset.storageKey,
    });

    return noStoreJson({
      success: true,
      assetId: asset.id,
      key: signed.key,
      downloadUrl: signed.downloadUrl,
      expiresInSeconds: signed.expiresInSeconds,
    });
  },
);
