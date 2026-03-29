import { NextRequest, NextResponse } from "next/server";
import { isDatabaseConfigured } from "@/lib/db";
import { canUseS3Storage, createPresignedDownload, objectExistsInS3 } from "@/lib/storage";
import { authorizeStudioRequest, authzErrorResponse } from "@/lib/studio/authz";
import { getProject } from "@/lib/studio/repository";

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

export async function POST(
  request: NextRequest,
): Promise<NextResponse<LegacyDownloadResponse>> {
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
    const body = (await request.json()) as LegacyDownloadRequest;
    const projectId = body.projectId?.trim();
    const legacyKey = body.legacyKey?.trim();

    if (!projectId || !legacyKey) {
      return NextResponse.json(
        {
          success: false,
          error: "projectId and legacyKey are required.",
        },
        { status: 400 },
      );
    }

    const authz = await authorizeStudioRequest(request, {
      route: "/api/studio/assets/legacy-download",
      action: "read",
    });
    if (!authz.authorized) {
      return authzErrorResponse(authz);
    }

    const project = await getProject(authz.workspaceId, projectId);
    if (!project) {
      return NextResponse.json(
        {
          success: false,
          error: "No access to this project.",
        },
        { status: 403 },
      );
    }

    if (!project.sourceDirectoryPath?.trim()) {
      return NextResponse.json(
        {
          success: false,
          error: "Project has no legacy source directory path.",
        },
        { status: 400 },
      );
    }

    const allowedPrefix = `workflows/${encodeURIComponent(project.sourceDirectoryPath)}/`;
    if (!legacyKey.startsWith(allowedPrefix)) {
      return NextResponse.json(
        {
          success: false,
          error: "Legacy key does not belong to this project.",
        },
        { status: 403 },
      );
    }

    const exists = await objectExistsInS3({ key: legacyKey });
    if (!exists) {
      return NextResponse.json(
        {
          success: false,
          error: "Legacy asset not found.",
        },
        { status: 404 },
      );
    }

    const signed = await createPresignedDownload({ key: legacyKey });

    return NextResponse.json({
      success: true,
      key: signed.key,
      downloadUrl: signed.downloadUrl,
      expiresInSeconds: signed.expiresInSeconds,
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error ? error.message : "Failed to create legacy download URL",
      },
      { status: 500 },
    );
  }
}
