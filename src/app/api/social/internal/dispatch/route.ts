import { NextRequest, NextResponse } from "next/server";
import { start } from "workflow/api";
import { isDatabaseConfigured } from "@/lib/db";
import { ensureInternalSocialAuth } from "@/lib/social/internal-auth";
import { emitSocialEvent } from "@/lib/social/events";
import {
  claimPostForDispatch,
  listDueQueuedPosts,
  updatePostStatus,
} from "@/lib/social/repository";
import { resolveWorkflowRunRef } from "@/lib/social/workflow-utils";
import { publishPostWorkflow } from "@/../workflows/social-publish";
import { logger } from "@/utils/logger";

interface DispatchResponse {
  success: boolean;
  summary?: {
    scanned: number;
    dispatched: number;
    retryScheduled: number;
    failed: number;
    skipped: number;
  };
  error?: string;
}

const MAX_BATCH_SIZE = 100;
const DEFAULT_BATCH_SIZE = 20;
const DEFAULT_MAX_DISPATCH_ATTEMPTS = 5;

function getBatchSize(request: NextRequest): number {
  const queryBatch = Number.parseInt(
    request.nextUrl.searchParams.get("batch") ?? "",
    10,
  );
  const envBatch = Number.parseInt(
    process.env.SOCIAL_DISPATCH_BATCH_SIZE ?? "",
    10,
  );

  const raw = Number.isFinite(queryBatch)
    ? queryBatch
    : Number.isFinite(envBatch)
      ? envBatch
      : DEFAULT_BATCH_SIZE;

  return Math.max(1, Math.min(MAX_BATCH_SIZE, raw));
}

function getMaxDispatchAttempts(): number {
  const value = Number.parseInt(
    process.env.SOCIAL_DISPATCH_MAX_ATTEMPTS ?? "",
    10,
  );
  return Number.isFinite(value) && value > 0
    ? value
    : DEFAULT_MAX_DISPATCH_ATTEMPTS;
}

function backoffMs(attempts: number): number {
  const base = 5 * 60 * 1000;
  return Math.min(60 * 60 * 1000, base * Math.max(1, attempts));
}

export async function POST(
  request: NextRequest,
): Promise<NextResponse<DispatchResponse>> {
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
    const batchSize = getBatchSize(request);
    const maxDispatchAttempts = getMaxDispatchAttempts();
    const now = new Date();

    const duePosts = await listDueQueuedPosts({
      now,
      limit: batchSize,
    });

    let dispatched = 0;
    let retryScheduled = 0;
    let failed = 0;
    let skipped = 0;

    for (const post of duePosts) {
      const dispatchKey = `dispatch:${post.id}`;
      const claimed = await claimPostForDispatch({
        postId: post.id,
        now,
      });

      if (!claimed) {
        skipped += 1;
        continue;
      }

      try {
        const workflowRun = await start(publishPostWorkflow, [
          claimed.id,
          claimed.workspaceId,
        ]);
        const workflowRunRef = resolveWorkflowRunRef(
          workflowRun,
          dispatchKey,
        );

        await updatePostStatus(claimed.id, "queued", {
          dispatchStatus: "dispatched",
          workflowRunRef,
          nextDispatchAt: null,
          lastDispatchError: null,
          lockedAt: null,
        });
        logger.info("system", "Internal social dispatch succeeded", {
          workspaceId: claimed.workspaceId,
          postId: claimed.id,
          dispatchKey,
          workflowRunRef,
        });
        dispatched += 1;
      } catch (error) {
        const attempts = claimed.dispatchAttempts ?? 1;
        const errorMessage =
          error instanceof Error ? error.message : "Unknown workflow dispatch error";

        if (attempts >= maxDispatchAttempts) {
          await updatePostStatus(claimed.id, "failed", {
            dispatchStatus: "failed",
            errorMessage: "Dispatch failed after maximum retry attempts.",
            nextDispatchAt: null,
            workflowRunRef: null,
            lastDispatchError: errorMessage,
            lockedAt: null,
          });
          await emitSocialEvent({
            workspaceId: claimed.workspaceId,
            eventType: "post.failed",
            severity: "error",
            message: "Post failed after repeated dispatch failures.",
            userFacing: true,
            postId: claimed.id,
            dispatchKey,
            metadata: {
              attempts,
              error: errorMessage,
            },
          });
          logger.error("system", "Internal social dispatch exhausted retries", {
            workspaceId: claimed.workspaceId,
            postId: claimed.id,
            dispatchKey,
            workflowRunRef: null,
            error: errorMessage,
          });
          failed += 1;
          continue;
        }

        const nextDispatchAt = new Date(now.getTime() + backoffMs(attempts));
        await updatePostStatus(claimed.id, "queued", {
          dispatchStatus: "retry_scheduled",
          errorMessage: "Dispatch failed. Retry has been scheduled.",
          workflowRunRef: null,
          nextDispatchAt,
          lastDispatchError: errorMessage,
          lockedAt: null,
        });
        await emitSocialEvent({
          workspaceId: claimed.workspaceId,
          eventType: "dispatch.failed",
          severity: "warn",
          message: "Dispatch failed and was scheduled for retry.",
          postId: claimed.id,
          dispatchKey,
          metadata: {
            attempts,
            error: errorMessage,
            retryAt: nextDispatchAt.toISOString(),
          },
        });
        logger.warn("system", "Internal social dispatch scheduled retry", {
          workspaceId: claimed.workspaceId,
          postId: claimed.id,
          dispatchKey,
          workflowRunRef: null,
          error: errorMessage,
        });
        retryScheduled += 1;
      }
    }

    return NextResponse.json({
      success: true,
      summary: {
        scanned: duePosts.length,
        dispatched,
        retryScheduled,
        failed,
        skipped,
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to dispatch queued social posts",
      },
      { status: 500 },
    );
  }
}
