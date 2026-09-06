import { NextRequest, NextResponse } from "next/server";
import { getObjectStreamFromS3 } from "@/lib/storage";
import { collectStreamedAssetEvidence } from "@/lib/studio/asset-media-evidence";
import {
  finalizeAssetUpload,
  getAsset,
  softDeleteAsset,
  StudioAssetNotFoundError,
  StudioAssetUploadTransitionError,
} from "@/lib/studio/repository";
import { withStudioAuth } from "@/lib/studio/withStudioAuth";

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

const MAX_VERIFIED_UPLOAD_BYTES = 500 * 1024 * 1024;

type AssetIdContext = { params: Promise<{ assetId: string }> };

export const GET = withStudioAuth<AssetIdContext>(
  { route: "/api/studio/assets/[assetId]", action: "read", permission: "assets:read" },
  async (
    _request: NextRequest,
    authz,
    context,
  ): Promise<NextResponse<AssetResponse>> => {
    const { assetId } = await context.params;
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
  },
);

export const DELETE = withStudioAuth<AssetIdContext>(
  { route: "/api/studio/assets/[assetId]", action: "delete", permission: "assets:delete" },
  async (
    _request: NextRequest,
    authz,
    context,
  ): Promise<NextResponse<AssetResponse>> => {
    const { assetId } = await context.params;
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
  },
);

export const PATCH = withStudioAuth<AssetIdContext>(
  { route: "/api/studio/assets/[assetId]", action: "write", permission: "assets:write" },
  async (
    request: NextRequest,
    authz,
    context,
  ): Promise<NextResponse<AssetResponse>> => {
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

    try {
      const { assetId } = await context.params;
      const existing = body.uploadState === "ready" ? await getAsset(authz.workspaceId, assetId) : null;
      if (body.uploadState === "ready" && !existing) throw new StudioAssetNotFoundError();
      const existingMetadata = existing?.metadata && typeof existing.metadata === "object" ? existing.metadata as Record<string, unknown> : {};
      if (body.uploadState === "ready" && existingMetadata.uploadState === "failed") {
        throw new StudioAssetUploadTransitionError("failed", "ready");
      }
      if (body.uploadState === "ready" && existingMetadata.uploadState === "ready" && /^sha256:[a-f0-9]{64}$/.test(existing?.checksum ?? "")) {
        return NextResponse.json({ success: true, asset: existing! });
      }
      if (body.uploadState === "ready" && existing?.storageProvider !== "s3") {
        return NextResponse.json({ success: false, error: "Only stored S3 uploads can be finalized as ready." }, { status: 422 });
      }

      let verified: Awaited<ReturnType<typeof collectStreamedAssetEvidence>> | null = null;
      let verifiedMimeType: string | undefined;
      if (body.uploadState === "ready" && existing) {
        const stored = await getObjectStreamFromS3({ key: existing.storageKey });
        const expectedSize = typeof existingMetadata.expectedSizeBytes === "number" ? existingMetadata.expectedSizeBytes : null;
        if (stored.contentLength > MAX_VERIFIED_UPLOAD_BYTES || (expectedSize !== null && stored.contentLength !== expectedSize) || (typeof body.sizeBytes === "number" && stored.contentLength !== body.sizeBytes)) {
          return NextResponse.json({ success: false, error: "Stored upload size does not match the reserved upload." }, { status: 422 });
        }
        verifiedMimeType = stored.contentType?.trim().toLowerCase() || (typeof body.mimeType === "string" ? body.mimeType.trim().toLowerCase() : existing.mimeType?.trim().toLowerCase()) || undefined;
        if (!verifiedMimeType) return NextResponse.json({ success: false, error: "Stored upload content type is missing." }, { status: 422 });
        try {
          verified = await collectStreamedAssetEvidence({ assetType: existing.type, mimeType: verifiedMimeType, body: stored.body, maximumBytes: MAX_VERIFIED_UPLOAD_BYTES });
        } catch (error) {
          if (error instanceof Error && /^(ASSET_|Input file)/.test(error.message)) {
            return NextResponse.json({ success: false, error: error.message }, { status: 422 });
          }
          throw error;
        }
      }
      const asset = await finalizeAssetUpload({
        workspaceId: authz.workspaceId,
        assetId,
        uploadState: body.uploadState,
        sizeBytes: verified?.sizeBytes ?? (typeof body.sizeBytes === "number" ? body.sizeBytes : undefined),
        checksum: verified?.checksum ?? (body.uploadState === "failed" && typeof body.checksum === "string" ? body.checksum : undefined),
        mimeType: verifiedMimeType ?? (typeof body.mimeType === "string" ? body.mimeType : undefined),
        width: verified?.width,
        height: verified?.height,
        durationSeconds: verified?.durationSeconds,
        metadata: verified?.metadata,
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

      // Re-throw to let the outer withStudioAuth catch handle as 500
      throw error;
    }
  },
);
