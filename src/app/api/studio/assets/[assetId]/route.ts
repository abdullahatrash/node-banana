import { NextRequest, NextResponse } from "next/server";
import { isDatabaseConfigured } from "@/lib/db";
import { authorizeStudioRequest, authzErrorResponse } from "@/lib/studio/authz";
import { getAsset, softDeleteAsset } from "@/lib/studio/repository";

interface AssetResponse {
  success: boolean;
  asset?: Awaited<ReturnType<typeof getAsset>>;
  error?: string;
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
