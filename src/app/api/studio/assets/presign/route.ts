import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { isDatabaseConfigured } from "@/lib/db";
import { assetTypeEnum } from "@/lib/db/schema";
import { canUseS3Storage, buildAssetObjectKey, createPresignedUpload } from "@/lib/storage";
import { authorizeStudioRequest, authzErrorResponse } from "@/lib/studio/authz";
import {
  getProject,
  recordPendingS3AssetWithQuota,
  StudioAssetQuotaExceededError,
} from "@/lib/studio/repository";

interface PresignRequest {
  projectId?: string | null;
  assetType: (typeof assetTypeEnum.enumValues)[number];
  fileName?: string;
  contentType: string;
  expectedSizeBytes: number;
}

interface PresignResponse {
  success: boolean;
  assetId?: string;
  key?: string;
  uploadUrl?: string;
  downloadUrl?: string;
  expiresInSeconds?: number;
  error?: string;
}

export async function POST(
  request: NextRequest,
): Promise<NextResponse<PresignResponse>> {
  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      {
        success: false,
        error:
          "DATABASE_URL is not configured. Configure Postgres to use S3 presign APIs.",
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
    const body = (await request.json()) as PresignRequest;
    if (!assetTypeEnum.enumValues.includes(body.assetType)) {
      return NextResponse.json(
        { success: false, error: `Unsupported asset type: ${body.assetType}` },
        { status: 400 },
      );
    }
    if (!body.contentType?.trim()) {
      return NextResponse.json(
        { success: false, error: "contentType is required." },
        { status: 400 },
      );
    }
    if (
      typeof body.expectedSizeBytes !== "number" ||
      !Number.isFinite(body.expectedSizeBytes) ||
      !Number.isInteger(body.expectedSizeBytes) ||
      body.expectedSizeBytes < 0
    ) {
      return NextResponse.json(
        {
          success: false,
          error: "expectedSizeBytes is required and must be a non-negative integer.",
        },
        { status: 400 },
      );
    }

    const authz = await authorizeStudioRequest(request, {
      route: "/api/studio/assets/presign",
      action: "write",
    });
    if (!authz.authorized) {
      return authzErrorResponse(authz);
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

    const extFromName = body.fileName ? path.extname(body.fileName) : "";
    const key = buildAssetObjectKey({
      workspaceId: authz.workspaceId,
      projectId: body.projectId || null,
      assetType: body.assetType,
      fileExtension: extFromName || undefined,
    });

    const signed = await createPresignedUpload({
      key,
      contentType: body.contentType.trim(),
    });

    const asset = await recordPendingS3AssetWithQuota({
      workspaceId: authz.workspaceId,
      userId: authz.userId,
      projectId: body.projectId || null,
      type: body.assetType,
      storageBucket: process.env.S3_BUCKET_NAME || null,
      storageKey: key,
      mimeType: body.contentType.trim(),
      originalFileName: body.fileName || null,
      expectedSizeBytes: body.expectedSizeBytes,
    });

    return NextResponse.json({
      success: true,
      assetId: asset.id,
      key: signed.key,
      uploadUrl: signed.uploadUrl,
      downloadUrl: signed.downloadUrl,
      expiresInSeconds: signed.expiresInSeconds,
    });
  } catch (error) {
    if (error instanceof StudioAssetQuotaExceededError) {
      return NextResponse.json(
        {
          success: false,
          error: "Workspace storage quota exceeded.",
        },
        { status: 403 },
      );
    }

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to create presigned URL",
      },
      { status: 500 },
    );
  }
}
