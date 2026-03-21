import { NextRequest, NextResponse } from "next/server";
import { isDatabaseConfigured } from "@/lib/db";
import { assetTypeEnum, storageProviderEnum } from "@/lib/db/schema";
import { authorizeStudioRequest, authzErrorResponse } from "@/lib/studio/authz";
import { listProjectAssets, recordAsset } from "@/lib/studio/repository";

interface AssetsGetResponse {
  success: boolean;
  assets?: Awaited<ReturnType<typeof listProjectAssets>>;
  error?: string;
}

interface AssetsPostRequest {
  projectId?: string | null;
  type: (typeof assetTypeEnum.enumValues)[number];
  storageProvider: (typeof storageProviderEnum.enumValues)[number];
  storageBucket?: string | null;
  storageKey: string;
  mimeType?: string | null;
  sizeBytes?: number | null;
  width?: number | null;
  height?: number | null;
  durationSeconds?: number | null;
  checksum?: string | null;
  metadata?: Record<string, unknown> | null;
}

interface AssetsPostResponse {
  success: boolean;
  asset?: Awaited<ReturnType<typeof recordAsset>>;
  error?: string;
}

export async function GET(
  request: NextRequest,
): Promise<NextResponse<AssetsGetResponse>> {
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

  const projectId = request.nextUrl.searchParams.get("projectId");
  if (!projectId) {
    return NextResponse.json(
      {
        success: false,
        error: "projectId query parameter is required.",
      },
      { status: 400 },
    );
  }

  try {
    const authz = await authorizeStudioRequest(request, {
      route: "/api/studio/assets",
      action: "read",
    });
    if (!authz.authorized) {
      return authzErrorResponse(authz);
    }

    const assets = await listProjectAssets(authz.workspaceId, projectId);
    return NextResponse.json({
      success: true,
      assets,
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to list assets",
      },
      { status: 500 },
    );
  }
}

export async function POST(
  request: NextRequest,
): Promise<NextResponse<AssetsPostResponse>> {
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
    const body = (await request.json()) as AssetsPostRequest;
    if (!body.storageKey?.trim()) {
      return NextResponse.json(
        { success: false, error: "storageKey is required." },
        { status: 400 },
      );
    }
    if (!assetTypeEnum.enumValues.includes(body.type)) {
      return NextResponse.json(
        { success: false, error: `Unsupported asset type: ${body.type}` },
        { status: 400 },
      );
    }
    if (!storageProviderEnum.enumValues.includes(body.storageProvider)) {
      return NextResponse.json(
        {
          success: false,
          error: `Unsupported storage provider: ${body.storageProvider}`,
        },
        { status: 400 },
      );
    }

    const authz = await authorizeStudioRequest(request, {
      route: "/api/studio/assets",
      action: "write",
    });
    if (!authz.authorized) {
      return authzErrorResponse(authz);
    }

    const asset = await recordAsset({
      workspaceId: authz.workspaceId,
      userId: authz.userId,
      projectId: body.projectId || null,
      type: body.type,
      storageProvider: body.storageProvider,
      storageBucket: body.storageBucket || null,
      storageKey: body.storageKey.trim(),
      mimeType: body.mimeType || null,
      sizeBytes: body.sizeBytes ?? null,
      width: body.width ?? null,
      height: body.height ?? null,
      durationSeconds: body.durationSeconds ?? null,
      checksum: body.checksum || null,
      metadata: body.metadata || null,
    });

    return NextResponse.json({
      success: true,
      asset,
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to record asset",
      },
      { status: 500 },
    );
  }
}
