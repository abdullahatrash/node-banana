import { NextRequest, NextResponse } from "next/server";
import { isDatabaseConfigured } from "@/lib/db";
import { deleteObjectFromS3 } from "@/lib/storage";
import { ensureInternalStudioAuth } from "@/lib/studio/internal-auth";
import {
  finalizeAssetUpload,
  listExpiredPendingAssets,
} from "@/lib/studio/repository";

interface OrphanCleanupResponse {
  success: boolean;
  summary?: {
    scanned: number;
    failedAssets: number;
    deletedObjects: number;
    errors: number;
  };
  error?: string;
}

const DEFAULT_BATCH_SIZE = 100;
const MAX_BATCH_SIZE = 500;

function intFromQuery(request: NextRequest, key: string): number | null {
  const raw = request.nextUrl.searchParams.get(key);
  if (!raw) return null;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) && value > 0 ? value : null;
}

export async function POST(
  request: NextRequest,
): Promise<NextResponse<OrphanCleanupResponse>> {
  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      { success: false, error: "DATABASE_URL is not configured." },
      { status: 503 },
    );
  }

  const authFailure = ensureInternalStudioAuth(request);
  if (authFailure) {
    return authFailure;
  }

  try {
    const limit = Math.min(
      MAX_BATCH_SIZE,
      intFromQuery(request, "limit") ?? DEFAULT_BATCH_SIZE,
    );
    const deleteObjects = request.nextUrl.searchParams.get("deleteObjects") !== "false";

    const expiredAssets = await listExpiredPendingAssets({ limit });

    let failedAssets = 0;
    let deletedObjects = 0;
    let errors = 0;

    for (const asset of expiredAssets) {
      if (deleteObjects && asset.storageKey) {
        try {
          await deleteObjectFromS3({ key: asset.storageKey });
          deletedObjects += 1;
        } catch {
          errors += 1;
        }
      }

      try {
        await finalizeAssetUpload({
          workspaceId: asset.workspaceId,
          assetId: asset.id,
          uploadState: "failed",
          error: "Expired pending upload cleaned up by orphan-cleanup job",
        });
        failedAssets += 1;
      } catch {
        errors += 1;
      }
    }

    return NextResponse.json({
      success: true,
      summary: {
        scanned: expiredAssets.length,
        failedAssets,
        deletedObjects,
        errors,
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to clean up orphaned assets",
      },
      { status: 500 },
    );
  }
}
