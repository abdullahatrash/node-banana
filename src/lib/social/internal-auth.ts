import { NextRequest, NextResponse } from "next/server";

export interface InternalAuthFailureResponse {
  success: false;
  error: string;
}

function extractInternalSecret(request: NextRequest): string | null {
  const headerSecret = request.headers.get("x-social-internal-secret");
  if (headerSecret?.trim()) {
    return headerSecret.trim();
  }

  const authHeader = request.headers.get("authorization") ?? "";
  if (authHeader.toLowerCase().startsWith("bearer ")) {
    const token = authHeader.slice(7).trim();
    return token || null;
  }

  return null;
}

export function ensureInternalSocialAuth(
  request: NextRequest,
): NextResponse<InternalAuthFailureResponse> | null {
  const expectedSecret = process.env.SOCIAL_INTERNAL_API_SECRET;
  if (!expectedSecret?.trim()) {
    return NextResponse.json(
      {
        success: false,
        error: "SOCIAL_INTERNAL_API_SECRET is not configured.",
      },
      { status: 503 },
    );
  }

  const providedSecret = extractInternalSecret(request);
  if (!providedSecret || providedSecret !== expectedSecret) {
    return NextResponse.json(
      {
        success: false,
        error: "Unauthorized internal request.",
      },
      { status: 401 },
    );
  }

  return null;
}
