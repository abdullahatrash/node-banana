import { NextRequest, NextResponse } from "next/server";
import { isDatabaseConfigured } from "@/lib/db";
import { deleteObjectFromS3 } from "@/lib/storage";
import { ensureInternalStudioAuth } from "@/lib/studio/internal-auth";
import {
  hardDeleteAsset,
  listPurgeableSoftDeletedAssets,
} from "@/lib/studio/repository";

interface PurgeDeletedResponse {
  success: boolean;
  summary?: {
    scanned: number;
    purgedRecords: number;
    deletedObjects: number;
    errors: number;
  };
  error?: string;
}

const DEFAULT_BATCH_SIZE = 100;
const MAX_BATCH_SIZE = 500;
const DEFAULT_RETENTION_DAYS = 30;

function intFromQuery(request: NextRequest, key: string): number | null {
  const raw = request.nextUrl.searchParams.get(key);
  if (!raw) return null;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) && value > 0 ? value : null;
}

export async function POST(
  request: NextRequest,
): Promise<NextResponse<PurgeDeletedResponse>> {
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
    const retentionDays = intFromQuery(request, "retentionDays") ?? DEFAULT_RETENTION_DAYS;
    const limit = Math.min(
      MAX_BATCH_SIZE,
      intFromQuery(request, "limit") ?? DEFAULT_BATCH_SIZE,
    );

    const purgeableAssets = await listPurgeableSoftDeletedAssets({
      retentionDays,
      limit,
    });

    let purgedRecords = 0;
    let deletedObjects = 0;
    let errors = 0;

    for (const asset of purgeableAssets) {
      // Delete R2 object first, then DB record — safer ordering.
      // If R2 delete succeeds but DB delete fails, next run retries
      // (R2 delete is idempotent). Reverse order would orphan R2 objects.
      if (asset.storageKey) {
        try {
          await deleteObjectFromS3({ key: asset.storageKey });
          deletedObjects += 1;
        } catch {
          errors += 1;
          continue; // Skip DB delete if R2 delete fails to avoid orphaning
        }
      }

      try {
        const deleted = await hardDeleteAsset({ assetId: asset.id });
        if (deleted) {
          purgedRecords += 1;
        }
      } catch {
        errors += 1;
      }
    }

    return NextResponse.json({
      success: true,
      summary: {
        scanned: purgeableAssets.length,
        purgedRecords,
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
            : "Failed to purge deleted assets",
      },
      { status: 500 },
    );
  }
}
