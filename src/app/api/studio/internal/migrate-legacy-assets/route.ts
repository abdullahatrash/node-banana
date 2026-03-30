import { NextRequest, NextResponse } from "next/server";
import { isDatabaseConfigured } from "@/lib/db";
import {
  buildAssetObjectKey,
  copyObjectInS3,
  deleteObjectFromS3,
  listObjectsInS3,
} from "@/lib/storage";
import { ensureInternalStudioAuth } from "@/lib/studio/internal-auth";
import { recordAsset } from "@/lib/studio/repository";

interface MigrateLegacyResponse {
  success: boolean;
  summary?: {
    scanned: number;
    migrated: number;
    errors: number;
    nextContinuationToken?: string;
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

function inferAssetType(key: string): "image" | "video" | "audio" | "model3d" {
  const ext = key.split(".").pop()?.toLowerCase();
  if (ext && ["mp4", "webm", "mov"].includes(ext)) return "video";
  if (ext && ["mp3", "wav", "ogg", "flac", "aac"].includes(ext)) return "audio";
  if (ext && ["glb", "gltf", "obj", "usdz", "fbx", "stl"].includes(ext)) return "model3d";
  return "image";
}

function inferMimeType(key: string): string {
  const ext = key.split(".").pop()?.toLowerCase();
  const map: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    svg: "image/svg+xml",
    mp4: "video/mp4",
    webm: "video/webm",
    mov: "video/quicktime",
    mp3: "audio/mpeg",
    wav: "audio/wav",
    ogg: "audio/ogg",
    glb: "model/gltf-binary",
    gltf: "model/gltf+json",
  };
  return (ext && map[ext]) || "application/octet-stream";
}

function extractExtension(key: string): string {
  const ext = key.split(".").pop()?.toLowerCase();
  return ext || "bin";
}

export async function POST(
  request: NextRequest,
): Promise<NextResponse<MigrateLegacyResponse>> {
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
    const workspaceId = request.nextUrl.searchParams.get("workspaceId");
    const userId = request.nextUrl.searchParams.get("userId") || "system";
    const deleteOriginal = request.nextUrl.searchParams.get("deleteOriginal") === "true";
    const continuationToken = request.nextUrl.searchParams.get("continuationToken") || undefined;

    if (!workspaceId) {
      return NextResponse.json(
        { success: false, error: "workspaceId query parameter is required." },
        { status: 400 },
      );
    }

    const listing = await listObjectsInS3({
      prefix: "workflows/",
      maxKeys: limit,
      continuationToken,
    });

    let migrated = 0;
    let errors = 0;

    for (const legacyKey of listing.keys) {
      try {
        const assetType = inferAssetType(legacyKey);
        const mimeType = inferMimeType(legacyKey);
        const extension = extractExtension(legacyKey);

        const newKey = buildAssetObjectKey({
          workspaceId,
          assetType,
          fileExtension: extension,
        });

        await copyObjectInS3({
          sourceKey: legacyKey,
          destinationKey: newKey,
        });

        await recordAsset({
          workspaceId,
          userId,
          type: assetType,
          storageProvider: "s3",
          storageBucket: process.env.S3_BUCKET_NAME || null,
          storageKey: newKey,
          mimeType,
          metadata: {
            uploadState: "ready",
            migratedFrom: legacyKey,
            migratedAt: new Date().toISOString(),
          },
        });

        if (deleteOriginal) {
          await deleteObjectFromS3({ key: legacyKey }).catch(() => {
            // Best effort — the copy is the source of truth now
          });
        }

        migrated += 1;
      } catch {
        errors += 1;
      }
    }

    return NextResponse.json({
      success: true,
      summary: {
        scanned: listing.keys.length,
        migrated,
        errors,
        nextContinuationToken: listing.nextContinuationToken,
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to migrate legacy assets",
      },
      { status: 500 },
    );
  }
}
