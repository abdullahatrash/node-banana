import { NextRequest, NextResponse } from "next/server";
import { isDatabaseConfigured } from "@/lib/db";
import { resolveRequestContext } from "@/lib/server/requestContext";
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
    const context = await resolveRequestContext(request);
    const { assetId } = await params;
    const asset = await getAsset(context.workspaceId, assetId);
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
    const context = await resolveRequestContext(request);
    const { assetId } = await params;
    const asset = await softDeleteAsset(context.workspaceId, assetId);
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
