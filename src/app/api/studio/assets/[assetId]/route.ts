import { NextRequest, NextResponse } from "next/server";
import { isDatabaseConfigured } from "@/lib/db";
import { authorizeStudioRequest, authzErrorResponse } from "@/lib/studio/authz";
import {
  finalizeAssetUpload,
  getAsset,
  softDeleteAsset,
  StudioAssetNotFoundError,
  StudioAssetUploadTransitionError,
} from "@/lib/studio/repository";

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

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ assetId: string }> },
): Promise<NextResponse<AssetResponse>> {
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

  try {
    const authz = await authorizeStudioRequest(request, {
      route: "/api/studio/assets/[assetId]",
      action: "read",
    });
    if (!authz.authorized) {
      return authzErrorResponse(authz);
    }

    const { assetId } = await params;
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
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to load asset",
      },
      { status: 500 },
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ assetId: string }> },
): Promise<NextResponse<AssetResponse>> {
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

  try {
    const authz = await authorizeStudioRequest(request, {
      route: "/api/studio/assets/[assetId]",
      action: "delete",
    });
    if (!authz.authorized) {
      return authzErrorResponse(authz);
    }

    const { assetId } = await params;
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
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to delete asset",
      },
      { status: 500 },
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ assetId: string }> },
): Promise<NextResponse<AssetResponse>> {
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

  try {
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

    const authz = await authorizeStudioRequest(request, {
      route: "/api/studio/assets/[assetId]",
      action: "write",
    });
    if (!authz.authorized) {
      return authzErrorResponse(authz);
    }

    const { assetId } = await params;
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

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to finalize asset upload",
      },
      { status: 500 },
    );
  }
}
