import { NextRequest, NextResponse } from "next/server";
import { noStoreJson } from "@/lib/agent-auth/http-request";
import { canUseS3Storage, createPresignedDownload, objectExistsInS3 } from "@/lib/storage";
import { getProject } from "@/lib/studio/repository";
import { withStudioAuth } from "@/lib/studio/withStudioAuth";

interface LegacyDownloadRequest {
  projectId?: string;
  legacyKey?: string;
}

interface LegacyDownloadResponse {
  success: boolean;
  key?: string;
  downloadUrl?: string;
  expiresInSeconds?: number;
  error?: string;
}

export const POST = withStudioAuth<undefined>(
  { route: "/api/studio/assets/legacy-download", action: "read" },
  async (request: NextRequest, authz): Promise<NextResponse<LegacyDownloadResponse>> => {
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

    const body = (await request.json()) as LegacyDownloadRequest;
    const projectId = body.projectId?.trim();
    const legacyKey = body.legacyKey?.trim();

    if (!projectId || !legacyKey) {
      return noStoreJson(
        {
          success: false,
          error: "projectId and legacyKey are required.",
        },
        { status: 400 },
      );
    }

    const project = await getProject(authz.workspaceId, projectId);
    if (!project) {
      return noStoreJson(
        {
          success: false,
          error: "No access to this project.",
        },
        { status: 403 },
      );
    }

    if (!project.sourceDirectoryPath?.trim()) {
      return noStoreJson(
        {
          success: false,
          error: "Project has no legacy source directory path.",
        },
        { status: 400 },
      );
    }

    const allowedPrefix = `workflows/${encodeURIComponent(project.sourceDirectoryPath)}/`;
    if (!legacyKey.startsWith(allowedPrefix)) {
      return noStoreJson(
        {
          success: false,
          error: "Legacy key does not belong to this project.",
        },
        { status: 403 },
      );
    }

    const exists = await objectExistsInS3({ key: legacyKey });
    if (!exists) {
      return noStoreJson(
        {
          success: false,
          error: "Legacy asset not found.",
        },
        { status: 404 },
      );
    }

    const signed = await createPresignedDownload({ key: legacyKey });

    return noStoreJson({
      success: true,
      key: signed.key,
      downloadUrl: signed.downloadUrl,
      expiresInSeconds: signed.expiresInSeconds,
    });
  },
);
