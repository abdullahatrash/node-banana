import { createHash, timingSafeEqual } from "node:crypto";
import { NextRequest, type NextResponse } from "next/server";
import { noStoreJson } from "@/lib/agent-auth/http-request";

export interface InternalAuthFailureResponse {
  success: false;
  error: string;
}

function extractBearerSecret(request: NextRequest): string | null {
  const authHeader = request.headers.get("authorization") ?? "";
  if (authHeader.toLowerCase().startsWith("bearer ")) {
    const token = authHeader.slice(7).trim();
    return token || null;
  }

  return null;
}

function secretMatches(provided: string | null, expected: string | undefined) {
  const normalizedExpected = expected?.trim();
  if (!provided || !normalizedExpected) return false;
  const providedDigest = createHash("sha256").update(provided, "utf8").digest();
  const expectedDigest = createHash("sha256")
    .update(normalizedExpected, "utf8")
    .digest();
  return timingSafeEqual(providedDigest, expectedDigest);
}

function unauthorized(): NextResponse<InternalAuthFailureResponse> {
  return noStoreJson(
    {
      success: false,
      error: "Unauthorized internal request.",
    },
    { status: 401 },
  );
}

export function ensureInternalStudioAuth(
  request: NextRequest,
): NextResponse<InternalAuthFailureResponse> | null {
  const expectedSecret = process.env.STUDIO_INTERNAL_API_SECRET;
  if (!expectedSecret?.trim()) {
    return noStoreJson(
      {
        success: false,
        error: "STUDIO_INTERNAL_API_SECRET is not configured.",
      },
      { status: 503 },
    );
  }

  const headerSecret = request.headers
    .get("x-studio-internal-secret")
    ?.trim() || null;
  const bearerSecret = extractBearerSecret(request);
  if (
    !secretMatches(headerSecret, expectedSecret) &&
    !secretMatches(bearerSecret, expectedSecret)
  ) return unauthorized();

  return null;
}

/**
 * Authorizes Studio maintenance invoked either manually or by Vercel Cron.
 * CRON_SECRET is intentionally accepted only from the bearer header that
 * Vercel attaches to scheduled GET requests.
 */
export function ensureInternalStudioOrCronAuth(
  request: NextRequest,
): NextResponse<InternalAuthFailureResponse> | null {
  const studioSecret = process.env.STUDIO_INTERNAL_API_SECRET;
  const cronSecret = process.env.CRON_SECRET;
  if (!studioSecret?.trim() && !cronSecret?.trim()) {
    return noStoreJson(
      {
        success: false,
        error: "Internal maintenance authentication is not configured.",
      },
      { status: 503 },
    );
  }

  const headerSecret = request.headers
    .get("x-studio-internal-secret")
    ?.trim() || null;
  const bearerSecret = extractBearerSecret(request);
  if (
    !secretMatches(headerSecret, studioSecret) &&
    !secretMatches(bearerSecret, studioSecret) &&
    !secretMatches(bearerSecret, cronSecret)
  ) return unauthorized();

  return null;
}
