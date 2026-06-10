import { NextRequest, NextResponse } from "next/server";
import {
  finalizeAssetUpload,
  getAsset,
  softDeleteAsset,
  StudioAssetNotFoundError,
  StudioAssetUploadTransitionError,
} from "@/lib/studio/repository";
import { withStudioAuth } from "@/lib/studio/withStudioAuth";

interface AssetResponse {
  success: boolean;
  asset?: Awaited<ReturnType<typeof getAsset>>;
  error?: string;
}

interface AssetPatchRequest {
  uploadState?: unknown;
  sizeBytes?: unknown;
  checksum?: unknown;
  mimeType?: unknown;
  error?: unknown;
}

type AssetIdContext = { params: Promise<{ assetId: string }> };

export const GET = withStudioAuth<AssetIdContext>(
  { route: "/api/studio/assets/[assetId]", action: "read" },
  async (
    _request: NextRequest,
    authz,
    context,
  ): Promise<NextResponse<AssetResponse>> => {
    const { assetId } = await context.params;
    const asset = await getAsset(authz.workspaceId, assetId);
    if (!asset) {
      return NextResponse.json(
        { success: false, error: "Asset not found." },
        { status: 404 },
      );
    }

    return NextResponse.json({
      success: true,
      asset,
    });
  },
);

export const DELETE = withStudioAuth<AssetIdContext>(
  { route: "/api/studio/assets/[assetId]", action: "delete" },
  async (
    _request: NextRequest,
    authz,
    context,
  ): Promise<NextResponse<AssetResponse>> => {
    const { assetId } = await context.params;
    const asset = await softDeleteAsset(authz.workspaceId, assetId);
    if (!asset) {
      return NextResponse.json(
        { success: false, error: "Asset not found." },
        { status: 404 },
      );
    }

    return NextResponse.json({
      success: true,
      asset,
    });
  },
);

export const PATCH = withStudioAuth<AssetIdContext>(
  { route: "/api/studio/assets/[assetId]", action: "write" },
  async (
    request: NextRequest,
    authz,
    context,
  ): Promise<NextResponse<AssetResponse>> => {
    const body = (await request.json()) as AssetPatchRequest;

    if (body.uploadState !== "ready" && body.uploadState !== "failed") {
      return NextResponse.json(
        { success: false, error: "uploadState is required and must be ready or failed." },
        { status: 400 },
      );
    }

    if (
      body.sizeBytes !== undefined &&
      (typeof body.sizeBytes !== "number" ||
        !Number.isFinite(body.sizeBytes) ||
        body.sizeBytes < 0)
    ) {
      return NextResponse.json(
        { success: false, error: "sizeBytes must be a non-negative number." },
        { status: 400 },
      );
    }

    if (body.checksum !== undefined && typeof body.checksum !== "string") {
      return NextResponse.json(
        { success: false, error: "checksum must be a string when provided." },
        { status: 400 },
      );
    }

    if (body.mimeType !== undefined && typeof body.mimeType !== "string") {
      return NextResponse.json(
        { success: false, error: "mimeType must be a string when provided." },
        { status: 400 },
      );
    }

    if (
      body.uploadState === "failed" &&
      (typeof body.error !== "string" || !body.error.trim())
    ) {
      return NextResponse.json(
        { success: false, error: "error is required when uploadState is failed." },
        { status: 400 },
      );
    }

    try {
      const { assetId } = await context.params;
      const asset = await finalizeAssetUpload({
        workspaceId: authz.workspaceId,
        assetId,
        uploadState: body.uploadState,
        sizeBytes: typeof body.sizeBytes === "number" ? body.sizeBytes : undefined,
        checksum: typeof body.checksum === "string" ? body.checksum : undefined,
        mimeType: typeof body.mimeType === "string" ? body.mimeType : undefined,
        error: typeof body.error === "string" ? body.error.trim() : undefined,
      });

      return NextResponse.json({
        success: true,
        asset,
      });
    } catch (error) {
      if (error instanceof StudioAssetNotFoundError) {
        return NextResponse.json(
          { success: false, error: "Asset not found." },
          { status: 404 },
        );
      }

      if (error instanceof StudioAssetUploadTransitionError) {
        return NextResponse.json(
          { success: false, error: error.message },
          { status: 409 },
        );
      }

      // Re-throw to let the outer withStudioAuth catch handle as 500
      throw error;
    }
  },
);
