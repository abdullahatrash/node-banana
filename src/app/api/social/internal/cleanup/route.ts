import { NextRequest, NextResponse } from "next/server";
import { isDatabaseConfigured } from "@/lib/db";
import {
  cleanupExpiredOAuthSelectionSessions,
  cleanupExpiredOAuthStates,
} from "@/lib/social/repository";

interface CleanupResponse {
  success: boolean;
  cleaned?: {
    oauthStates: number;
    selectionSessions: number;
  };
  error?: string;
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

export async function POST(
  request: NextRequest,
): Promise<NextResponse<CleanupResponse>> {
  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      { success: false, error: "DATABASE_URL is not configured." },
      { status: 503 },
    );
  }

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
      { success: false, error: "Unauthorized internal request." },
      { status: 401 },
    );
  }

  try {
    const [oauthStates, selectionSessions] = await Promise.all([
      cleanupExpiredOAuthStates(),
      cleanupExpiredOAuthSelectionSessions(),
    ]);

    return NextResponse.json({
      success: true,
      cleaned: {
        oauthStates,
        selectionSessions,
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to clean up expired social auth sessions",
      },
      { status: 500 },
    );
  }
}
