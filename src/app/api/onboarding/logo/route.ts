import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { noStoreJson } from "@/lib/agent-auth/http-request";
import {
  getDevFallbackUserId,
  getServerAuthSession,
  isDevAuthBypassEnabled,
  parseHeaderValue,
} from "@/lib/auth/session";
import { getDb, isDatabaseConfigured } from "@/lib/db";
import { onboardingSessions } from "@/lib/db/schema";
import { buildAssetObjectKey, canUseS3Storage, putObjectToS3 } from "@/lib/storage";
import {
  finalizeAssetUpload,
  recordPendingS3AssetWithQuota,
} from "@/lib/studio/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_LOGO_BYTES = 5 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/png", "image/jpeg"]);

function isExpectedMagic(bytes: Buffer, mimeType: string) {
  if (mimeType === "image/png") {
    return bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  }
  return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

function sameOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).origin === request.nextUrl.origin;
  } catch {
    return false;
  }
}

export async function POST(request: NextRequest) {
  if (!isDatabaseConfigured() || !canUseS3Storage()) {
    return noStoreJson(
      { success: false, error: "Logo storage is temporarily unavailable." },
      { status: 503 },
    );
  }
  if (!sameOrigin(request)) {
    return noStoreJson({ success: false, error: "A same-origin request is required." }, { status: 403 });
  }

  const session = await getServerAuthSession(request.headers);
  const userId =
    parseHeaderValue(session?.user?.id ?? null) ||
    (isDevAuthBypassEnabled() ? getDevFallbackUserId() : null);
  if (!userId || (!isDevAuthBypassEnabled() && session?.user?.emailVerified !== true)) {
    return noStoreJson({ success: false, error: "Verify your email before uploading a logo." }, { status: 403 });
  }

  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_LOGO_BYTES + 128 * 1024) {
    return noStoreJson({ success: false, error: "Logo must be 5 MB or smaller." }, { status: 413 });
  }

  const [onboarding] = await getDb()
    .select({ workspaceId: onboardingSessions.workspaceId })
    .from(onboardingSessions)
    .where(and(eq(onboardingSessions.userId, userId), eq(onboardingSessions.currentStep, "brand_source")))
    .limit(1);
  if (!onboarding?.workspaceId) {
    return noStoreJson({ success: false, error: "Save your company details before uploading a logo." }, { status: 409 });
  }

  const form = await request.formData();
  const value = form.get("logo");
  if (!(value instanceof File)) {
    return noStoreJson({ success: false, error: "Choose a PNG or JPEG logo." }, { status: 400 });
  }
  if (!ALLOWED_TYPES.has(value.type) || value.size === 0 || value.size > MAX_LOGO_BYTES) {
    return noStoreJson({ success: false, error: "Logo must be a PNG or JPEG up to 5 MB." }, { status: 400 });
  }

  const bytes = Buffer.from(await value.arrayBuffer());
  if (!isExpectedMagic(bytes, value.type)) {
    return noStoreJson({ success: false, error: "The file contents do not match its image type." }, { status: 400 });
  }

  const extension = value.type === "image/png" ? "png" : "jpg";
  const key = buildAssetObjectKey({
    workspaceId: onboarding.workspaceId,
    projectId: null,
    assetType: "image",
    fileExtension: extension,
  });
  const pending = await recordPendingS3AssetWithQuota({
    workspaceId: onboarding.workspaceId,
    userId,
    projectId: null,
    type: "image",
    storageBucket: process.env.S3_BUCKET_NAME || null,
    storageKey: key,
    mimeType: value.type,
    originalFileName: value.name.slice(0, 255),
    expectedSizeBytes: bytes.length,
  });

  try {
    await putObjectToS3({ key, body: bytes, contentType: value.type });
    await finalizeAssetUpload({
      workspaceId: onboarding.workspaceId,
      assetId: pending.id,
      uploadState: "ready",
      sizeBytes: bytes.length,
      checksum: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
      mimeType: value.type,
    });
  } catch (error) {
    await finalizeAssetUpload({
      workspaceId: onboarding.workspaceId,
      assetId: pending.id,
      uploadState: "failed",
      error: "Logo upload failed.",
    }).catch(() => undefined);
    throw error;
  }

  return noStoreJson({ success: true, assetId: pending.id });
}
