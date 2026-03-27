import { NextRequest, NextResponse } from "next/server";
import { isDatabaseConfigured } from "@/lib/db";
import { emitSocialEvent } from "@/lib/social/events";
import { ensureInternalSocialAuth } from "@/lib/social/internal-auth";
import { listStalePublishingPosts, updatePostStatus } from "@/lib/social/repository";
import { logger } from "@/utils/logger";

interface SweepResponse {
  success: boolean;
  summary?: {
    scanned: number;
    requeued: number;
    failed: number;
  };
  error?: string;
}

const DEFAULT_STALE_MINUTES = 30;
const DEFAULT_BATCH_SIZE = 50;
const DEFAULT_MAX_RECOVERY_ATTEMPTS = 3;
const MAX_BATCH_SIZE = 200;

function numberFromQuery(request: NextRequest, key: string): number | null {
  const raw = request.nextUrl.searchParams.get(key);
  if (!raw) return null;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function numberFromEnv(key: string): number | null {
  const raw = process.env[key];
  if (!raw) return null;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) && value > 0 ? value : null;
}

export async function POST(
  request: NextRequest,
): Promise<NextResponse<SweepResponse>> {
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
    const staleMinutes =
      numberFromQuery(request, "staleMinutes") ??
      numberFromEnv("SOCIAL_STUCK_PUBLISHING_MINUTES") ??
      DEFAULT_STALE_MINUTES;

    const batchSize = Math.min(
      MAX_BATCH_SIZE,
      numberFromQuery(request, "batch") ??
        numberFromEnv("SOCIAL_STUCK_SWEEP_BATCH_SIZE") ??
        DEFAULT_BATCH_SIZE,
    );

    const maxRecoveryAttempts =
      numberFromEnv("SOCIAL_STUCK_MAX_RECOVERY_ATTEMPTS") ??
      DEFAULT_MAX_RECOVERY_ATTEMPTS;

    const now = new Date();
    const staleBefore = new Date(now.getTime() - staleMinutes * 60 * 1000);

    const stalePosts = await listStalePublishingPosts({
      staleBefore,
      limit: batchSize,
    });

    let requeued = 0;
    let failed = 0;

    for (const post of stalePosts) {
      const nextRetryCount = (post.retryCount ?? 0) + 1;

      if (nextRetryCount > maxRecoveryAttempts) {
        await updatePostStatus(post.id, "failed", {
          retryCount: nextRetryCount,
          errorMessage:
            "Publishing timed out repeatedly and was moved to failed state.",
          dispatchStatus: "failed",
          nextDispatchAt: null,
          workflowRunRef: null,
          lastDispatchError: "stuck_publishing_timeout",
          lockedAt: null,
        });
        await emitSocialEvent({
          workspaceId: post.workspaceId,
          eventType: "post.failed",
          severity: "error",
          message: "Post failed after repeated publishing timeout recovery.",
          userFacing: true,
          postId: post.id,
          accountId: post.socialAccountId,
          metadata: {
            retryCount: nextRetryCount,
            reason: "stuck_publishing_timeout",
          },
        });
        logger.error("system", "Stuck publishing post moved to failed", {
          workspaceId: post.workspaceId,
          postId: post.id,
          accountId: post.socialAccountId,
          dispatchKey: null,
          workflowRunRef: post.workflowRunRef ?? null,
        });
        failed += 1;
        continue;
      }

      await updatePostStatus(post.id, "queued", {
        retryCount: nextRetryCount,
        errorMessage: "Publishing timed out. Post requeued for retry.",
        dispatchStatus: "retry_scheduled",
        nextDispatchAt: now,
        workflowRunRef: null,
        lastDispatchError: "stuck_publishing_timeout",
        lockedAt: null,
      });
      await emitSocialEvent({
        workspaceId: post.workspaceId,
        eventType: "dispatch.failed",
        severity: "warn",
        message: "Publishing timeout detected. Post requeued.",
        postId: post.id,
        accountId: post.socialAccountId,
        metadata: {
          retryCount: nextRetryCount,
          reason: "stuck_publishing_timeout",
        },
      });
      logger.warn("system", "Stuck publishing post requeued", {
        workspaceId: post.workspaceId,
        postId: post.id,
        accountId: post.socialAccountId,
        dispatchKey: null,
        workflowRunRef: post.workflowRunRef ?? null,
      });
      requeued += 1;
    }

    return NextResponse.json({
      success: true,
      summary: {
        scanned: stalePosts.length,
        requeued,
        failed,
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to sweep stuck publishing posts",
      },
      { status: 500 },
    );
  }
}
