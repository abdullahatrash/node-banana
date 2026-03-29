import { NextRequest, NextResponse } from "next/server";
import { isDatabaseConfigured } from "@/lib/db";
import { canUseS3Storage, createPresignedDownload } from "@/lib/storage";
import { authorizeStudioRequest, authzErrorResponse } from "@/lib/studio/authz";
import { getAsset } from "@/lib/studio/repository";

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

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ assetId: string }> },
): Promise<NextResponse<AssetDownloadResponse>> {
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

  try {
    const authz = await authorizeStudioRequest(request, {
      route: "/api/studio/assets/[assetId]/download",
      action: "read",
    });
    if (!authz.authorized) {
      return authzErrorResponse(authz);
    }

    const { assetId } = await params;
    const asset = await getAsset(authz.workspaceId, assetId);
    if (!asset) {
      return NextResponse.json(
        {
          success: false,
          error: "Asset not found.",
        },
        { status: 404 },
      );
    }

    if (asset.storageProvider !== "s3") {
      return NextResponse.json(
        {
          success: false,
          error: "Asset is not stored in S3/R2.",
        },
        { status: 400 },
      );
    }

    if (!asset.storageKey?.trim()) {
      return NextResponse.json(
        {
          success: false,
          error: "Asset has no storage key.",
        },
        { status: 400 },
      );
    }

    if (!isAssetReady(asset.metadata)) {
      return NextResponse.json(
        {
          success: false,
          error: "Asset upload is not ready.",
        },
        { status: 409 },
      );
    }

    const signed = await createPresignedDownload({
      key: asset.storageKey,
    });

    return NextResponse.json({
      success: true,
      assetId: asset.id,
      key: signed.key,
      downloadUrl: signed.downloadUrl,
      expiresInSeconds: signed.expiresInSeconds,
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error ? error.message : "Failed to create asset download URL",
      },
      { status: 500 },
    );
  }
}
