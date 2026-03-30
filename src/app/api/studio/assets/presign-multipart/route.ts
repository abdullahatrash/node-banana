import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { isDatabaseConfigured } from "@/lib/db";
import { assetTypeEnum } from "@/lib/db/schema";
import {
  abortMultipartUpload,
  buildAssetObjectKey,
  canUseS3Storage,
  completeMultipartUpload,
  createMultipartUpload,
  presignUploadPart,
} from "@/lib/storage";
import { authorizeStudioRequest, authzErrorResponse } from "@/lib/studio/authz";
import {
  finalizeAssetUpload,
  getProject,
  recordPendingS3AssetWithQuota,
  StudioAssetQuotaExceededError,
} from "@/lib/studio/repository";

type MultipartAction = "create" | "complete" | "abort";

interface CreateRequest {
  action: "create";
  projectId?: string | null;
  assetType: (typeof assetTypeEnum.enumValues)[number];
  fileName?: string;
  contentType: string;
  expectedSizeBytes: number;
  totalParts: number;
}

interface CompleteRequest {
  action: "complete";
  assetId: string;
  key: string;
  uploadId: string;
  parts: Array<{ partNumber: number; eTag: string }>;
  sizeBytes: number;
}

interface AbortRequest {
  action: "abort";
  assetId: string;
  key: string;
  uploadId: string;
}

type MultipartRequest = CreateRequest | CompleteRequest | AbortRequest;

interface MultipartResponse {
  success: boolean;
  assetId?: string;
  key?: string;
  uploadId?: string;
  partUrls?: Array<{ partNumber: number; uploadUrl: string }>;
  expiresInSeconds?: number;
  error?: string;
}

function isValidAction(action: unknown): action is MultipartAction {
  return action === "create" || action === "complete" || action === "abort";
}

export async function POST(
  request: NextRequest,
): Promise<NextResponse<MultipartResponse>> {
  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      { success: false, error: "DATABASE_URL is not configured." },
      { status: 503 },
    );
  }

  if (!canUseS3Storage()) {
    return NextResponse.json(
      { success: false, error: "S3 storage is not configured." },
      { status: 400 },
    );
  }

  try {
    const body = (await request.json()) as MultipartRequest;

    if (!isValidAction(body.action)) {
      return NextResponse.json(
        { success: false, error: "action must be one of: create, complete, abort." },
        { status: 400 },
      );
    }

    const authz = await authorizeStudioRequest(request, {
      route: "/api/studio/assets/presign-multipart",
      action: "write",
    });
    if (!authz.authorized) {
      return authzErrorResponse(authz);
    }

    if (body.action === "create") {
      return await handleCreate(body, authz);
    }
    if (body.action === "complete") {
      return await handleComplete(body, authz);
    }
    return await handleAbort(body, authz);
  } catch (error) {
    if (error instanceof StudioAssetQuotaExceededError) {
      return NextResponse.json(
        { success: false, error: "Workspace storage quota exceeded." },
        { status: 403 },
      );
    }
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Multipart upload failed",
      },
      { status: 500 },
    );
  }
}

async function handleCreate(
  body: CreateRequest,
  authz: { workspaceId: string; userId: string },
): Promise<NextResponse<MultipartResponse>> {
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
    body.expectedSizeBytes < 0
  ) {
    return NextResponse.json(
      { success: false, error: "expectedSizeBytes must be a non-negative number." },
      { status: 400 },
    );
  }
  if (
    typeof body.totalParts !== "number" ||
    !Number.isInteger(body.totalParts) ||
    body.totalParts < 1 ||
    body.totalParts > 10000
  ) {
    return NextResponse.json(
      { success: false, error: "totalParts must be an integer between 1 and 10000." },
      { status: 400 },
    );
  }

  if (body.projectId) {
    const project = await getProject(authz.workspaceId, body.projectId);
    if (!project) {
      return NextResponse.json(
        { success: false, error: "No access to this project." },
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

  const { uploadId } = await createMultipartUpload({
    key,
    contentType: body.contentType.trim(),
  });

  const partUrls = await Promise.all(
    Array.from({ length: body.totalParts }, (_, i) =>
      presignUploadPart({ key, uploadId, partNumber: i + 1 }),
    ),
  );

  return NextResponse.json({
    success: true,
    assetId: asset.id,
    key,
    uploadId,
    partUrls,
    expiresInSeconds: 900,
  });
}

async function handleComplete(
  body: CompleteRequest,
  authz: { workspaceId: string },
): Promise<NextResponse<MultipartResponse>> {
  if (!body.key || !body.uploadId || !body.assetId) {
    return NextResponse.json(
      { success: false, error: "key, uploadId, and assetId are required." },
      { status: 400 },
    );
  }
  if (!Array.isArray(body.parts) || body.parts.length === 0) {
    return NextResponse.json(
      { success: false, error: "parts array is required and must not be empty." },
      { status: 400 },
    );
  }

  await completeMultipartUpload({
    key: body.key,
    uploadId: body.uploadId,
    parts: body.parts,
  });

  await finalizeAssetUpload({
    workspaceId: authz.workspaceId,
    assetId: body.assetId,
    uploadState: "ready",
    sizeBytes: body.sizeBytes,
  });

  return NextResponse.json({
    success: true,
    assetId: body.assetId,
    key: body.key,
  });
}

async function handleAbort(
  body: AbortRequest,
  authz: { workspaceId: string },
): Promise<NextResponse<MultipartResponse>> {
  if (!body.key || !body.uploadId || !body.assetId) {
    return NextResponse.json(
      { success: false, error: "key, uploadId, and assetId are required." },
      { status: 400 },
    );
  }

  await abortMultipartUpload({
    key: body.key,
    uploadId: body.uploadId,
  });

  await finalizeAssetUpload({
    workspaceId: authz.workspaceId,
    assetId: body.assetId,
    uploadState: "failed",
    error: "Multipart upload aborted by client.",
  });

  return NextResponse.json({
    success: true,
    assetId: body.assetId,
  });
}
