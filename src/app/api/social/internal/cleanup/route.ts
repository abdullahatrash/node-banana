import { NextRequest, NextResponse } from "next/server";
import { isDatabaseConfigured } from "@/lib/db";
import { ensureInternalSocialAuth } from "@/lib/social/internal-auth";
import {
  cleanupExpiredOAuthSelectionSessions,
  cleanupExpiredOAuthStates,
} from "@/lib/social/repository";
import { logger } from "@/utils/logger";

interface CleanupResponse {
  success: boolean;
  cleaned?: {
    oauthStates: number;
    selectionSessions: number;
  };
  error?: string;
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

  const authFailure = ensureInternalSocialAuth(request);
  if (authFailure) {
    return authFailure;
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
    logger.error("system", "Social cleanup route failed", {
      workspaceId: null,
      postId: null,
      accountId: null,
      provider: null,
      dispatchKey: "social-cleanup",
      workflowRunRef: null,
      error: error instanceof Error ? error.message : "unknown",
    });
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
