import { NextRequest, NextResponse } from "next/server";
import { assetTypeEnum, storageProviderEnum } from "@/lib/db/schema";
import {
  getProject,
  listProjectAssets,
  listWorkspaceAssets,
  recordAsset,
} from "@/lib/studio/repository";
import { withStudioAuth } from "@/lib/studio/withStudioAuth";

interface AssetsGetResponse {
  success: boolean;
  assets?: Awaited<ReturnType<typeof listWorkspaceAssets>>;
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

export const GET = withStudioAuth<undefined>(
  { route: "/api/studio/assets", action: "read" },
  async (request: NextRequest, authz): Promise<NextResponse<AssetsGetResponse>> => {
    const projectId = request.nextUrl.searchParams.get("projectId");
    const assets = projectId
      ? await listProjectAssets(authz.workspaceId, projectId)
      : await listWorkspaceAssets(authz.workspaceId);
    return NextResponse.json({
      success: true,
      assets,
    });
  },
);

export const POST = withStudioAuth<undefined>(
  { route: "/api/studio/assets", action: "write" },
  async (request: NextRequest, authz): Promise<NextResponse<AssetsPostResponse>> => {
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

    if (body.projectId) {
      const project = await getProject(authz.workspaceId, body.projectId);
      if (!project) {
        return NextResponse.json(
          {
            success: false,
            error: "No access to this project.",
          },
          { status: 403 },
        );
      }
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
  },
);
