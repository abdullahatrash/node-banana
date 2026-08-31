import { NextRequest } from "next/server";
import { ZodError } from "zod";
import { noStoreJson } from "@/lib/agent-auth/http-request";
import {
  getDevFallbackUserId,
  getServerAuthSession,
  isDevAuthBypassEnabled,
  parseHeaderValue,
} from "@/lib/auth/session";
import { isDatabaseConfigured } from "@/lib/db";
import { OnboardingError } from "@/lib/onboarding/errors";
import { createProductionOnboardingService } from "@/lib/onboarding/production";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function authorize(request: NextRequest) {
  const session = await getServerAuthSession(request.headers);
  const userId = parseHeaderValue(session?.user?.id ?? null);
  if (userId) {
    return {
      userId,
      emailVerified: session?.user?.emailVerified === true,
    };
  }
  if (isDevAuthBypassEnabled()) {
    return { userId: getDevFallbackUserId(), emailVerified: true };
  }
  return null;
}

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
    {
      success: false,
      code: "ONBOARDING_UNAVAILABLE",
      error: "Onboarding is temporarily unavailable.",
    },
    { status: 503 },
  );
}

function errorResponse(error: unknown) {
  if (error instanceof OnboardingError) {
    return noStoreJson(
      { success: false, code: error.code, error: error.message, details: error.details },
      { status: error.status },
    );
  }
  if (error instanceof ZodError) {
    return noStoreJson(
      {
        success: false,
        code: "ONBOARDING_VALIDATION_FAILED",
        error: "Check the highlighted onboarding fields and try again.",
        details: { fields: error.issues.map((issue) => issue.path.join(".")) },
      },
      { status: 400 },
    );
  }
  return unavailable();
}

export async function GET(request: NextRequest) {
  if (!isDatabaseConfigured()) return unavailable();
  const identity = await authorize(request);
  if (!identity) {
    return noStoreJson(
      { success: false, code: "ONBOARDING_UNAUTHORIZED", error: "Sign in to continue." },
      { status: 401 },
    );
  }
  if (!identity.emailVerified) {
    return noStoreJson(
      {
        success: false,
        code: "EMAIL_VERIFICATION_REQUIRED",
        error: "Verify your email address before onboarding.",
      },
      { status: 403 },
    );
  }
  try {
    const snapshot = await createProductionOnboardingService().getSnapshot({
      userId: identity.userId,
    });
    return noStoreJson({ success: true, snapshot });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  if (!isDatabaseConfigured()) return unavailable();
  const identity = await authorize(request);
  if (!identity) {
    return noStoreJson(
      { success: false, code: "ONBOARDING_UNAUTHORIZED", error: "Sign in to continue." },
      { status: 401 },
    );
  }
  if (!identity.emailVerified) {
    return noStoreJson(
      {
        success: false,
        code: "EMAIL_VERIFICATION_REQUIRED",
        error: "Verify your email address before onboarding.",
      },
      { status: 403 },
    );
  }
  if (!sameOrigin(request)) {
    return noStoreJson(
      {
        success: false,
        code: "ONBOARDING_UNAUTHORIZED",
        error: "A same-origin request is required.",
      },
      { status: 403 },
    );
  }
  try {
    const command = await request.json();
    const snapshot = await createProductionOnboardingService().execute({
      userId: identity.userId,
      command,
    });
    return noStoreJson({ success: true, snapshot });
  } catch (error) {
    if (error instanceof SyntaxError) {
      return noStoreJson(
        {
          success: false,
          code: "ONBOARDING_VALIDATION_FAILED",
          error: "Request body must be valid JSON.",
        },
        { status: 400 },
      );
    }
    return errorResponse(error);
  }
}
