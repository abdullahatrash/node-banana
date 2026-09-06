import { NextRequest } from "next/server";
import { z } from "zod";
import { noStoreJson } from "@/lib/agent-auth/http-request";
import {
  IDENTITY_ERASURE_CONFIRMATION,
  isFreshIdentityErasureSession,
} from "@/lib/auth/identity-erasure-contract";
import {
  eraseIdentity,
  getIdentityErasurePreflight,
  IdentityErasureError,
} from "@/lib/auth/identity-erasure";
import { getServerAuthSession, parseHeaderValue } from "@/lib/auth/session";
import { auth } from "@/lib/auth/server";
import { isDatabaseConfigured } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z
  .object({
    confirmation: z.literal(IDENTITY_ERASURE_CONFIRMATION),
    acknowledgeAccessLoss: z.literal(true),
    acknowledgeMembershipRemoval: z.literal(true),
    exportHandled: z.literal(true),
    password: z.string().min(1).max(128).optional(),
  })
  .strict();

function sameOrigin(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).origin === request.nextUrl.origin;
  } catch {
    return false;
  }
}

function unavailable() {
  return noStoreJson(
    { success: false, code: "IDENTITY_ERASURE_UNAVAILABLE" },
    { status: 503 },
  );
}

function identityError(error: unknown) {
  if (error instanceof IdentityErasureError) {
    return noStoreJson(
      { success: false, code: error.code },
      { status: error.status },
    );
  }
  return unavailable();
}

async function authenticatedSession(request: NextRequest) {
  const current = await getServerAuthSession(request.headers);
  const userId = parseHeaderValue(current?.user?.id ?? null);
  return userId && current ? { userId, current } : null;
}

export async function GET(request: NextRequest) {
  if (!isDatabaseConfigured()) return unavailable();
  const session = await authenticatedSession(request);
  if (!session) {
    return noStoreJson(
      { success: false, code: "UNAUTHENTICATED" },
      { status: 401 },
    );
  }
  try {
    return noStoreJson({
      success: true,
      preflight: await getIdentityErasurePreflight(session.userId),
    });
  } catch (error) {
    return identityError(error);
  }
}

export async function POST(request: NextRequest) {
  if (!isDatabaseConfigured()) return unavailable();
  const session = await authenticatedSession(request);
  if (!session) {
    return noStoreJson(
      { success: false, code: "UNAUTHENTICATED" },
      { status: 401 },
    );
  }
  if (!sameOrigin(request)) {
    return noStoreJson(
      { success: false, code: "SAME_ORIGIN_REQUIRED" },
      { status: 403 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return noStoreJson(
      { success: false, code: "INVALID_INPUT" },
      { status: 400 },
    );
  }
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return noStoreJson(
      { success: false, code: "INVALID_INPUT" },
      { status: 400 },
    );
  }

  try {
    const preflight = await getIdentityErasurePreflight(session.userId);
    if (!preflight.canErase) {
      return noStoreJson(
        {
          success: false,
          code: "ACTIVE_OWNED_WORKSPACE",
          blockers: preflight.blockers,
        },
        { status: 409 },
      );
    }

    if (preflight.hasCredential) {
      if (!parsed.data.password) {
        return noStoreJson(
          { success: false, code: "PASSWORD_REQUIRED" },
          { status: 400 },
        );
      }
      try {
        const verified = await auth.api.verifyPassword({
          body: { password: parsed.data.password },
          headers: request.headers,
        });
        if (!verified.status) throw new Error("INVALID_PASSWORD");
      } catch {
        return noStoreJson(
          { success: false, code: "INVALID_PASSWORD" },
          { status: 403 },
        );
      }
    } else if (!isFreshIdentityErasureSession(session.current.session.createdAt)) {
      return noStoreJson(
        { success: false, code: "FRESH_SESSION_REQUIRED" },
        { status: 403 },
      );
    }

    const result = await eraseIdentity({ userId: session.userId });
    return noStoreJson({ success: true, result });
  } catch (error) {
    return identityError(error);
  }
}
