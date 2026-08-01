import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { noStoreJson } from "@/lib/agent-auth/http-request";
import { assetTypeEnum } from "@/lib/db/schema";
import { canUseS3Storage, buildAssetObjectKey, createPresignedUpload } from "@/lib/storage";
import {
  getProject,
  recordPendingS3AssetWithQuota,
  StudioAssetQuotaExceededError,
} from "@/lib/studio/repository";
import { withStudioAuth } from "@/lib/studio/withStudioAuth";

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

export const POST = withStudioAuth<undefined>(
  { route: "/api/studio/assets/presign", action: "write" },
  async (request: NextRequest, authz): Promise<NextResponse<PresignResponse>> => {
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

    try {
      const body = (await request.json()) as PresignRequest;
      if (!assetTypeEnum.enumValues.includes(body.assetType)) {
        return noStoreJson(
          { success: false, error: `Unsupported asset type: ${body.assetType}` },
          { status: 400 },
        );
      }
      if (!body.contentType?.trim()) {
        return noStoreJson(
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
        return noStoreJson(
          {
            success: false,
            error: "expectedSizeBytes is required and must be a non-negative integer.",
          },
          { status: 400 },
        );
      }

      if (body.projectId) {
        const project = await getProject(authz.workspaceId, body.projectId);
        if (!project) {
          return noStoreJson(
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

      return noStoreJson({
        success: true,
        assetId: asset.id,
        key: signed.key,
        uploadUrl: signed.uploadUrl,
        downloadUrl: signed.downloadUrl,
        expiresInSeconds: signed.expiresInSeconds,
      });
    } catch (error) {
      if (error instanceof StudioAssetQuotaExceededError) {
        return noStoreJson(
          {
            success: false,
            error: "Workspace storage quota exceeded.",
          },
          { status: 403 },
        );
      }
      // Re-throw to let the outer withStudioAuth catch handle as 500
      throw error;
    }
  },
);
