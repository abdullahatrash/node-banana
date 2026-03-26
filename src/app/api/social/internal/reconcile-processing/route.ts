import { NextRequest, NextResponse } from "next/server";
import { isDatabaseConfigured } from "@/lib/db";
import { decryptToken } from "@/lib/social/crypto";
import { emitSocialEvent } from "@/lib/social/events";
import { ensureInternalSocialAuth } from "@/lib/social/internal-auth";
import { getProvider } from "@/lib/social/provider-registry";
import {
  listPublishingPostsForReconciliation,
  markRequiresReauth,
  updatePostStatus,
} from "@/lib/social/repository";
import { logger } from "@/utils/logger";

interface ReconcileResponse {
  success: boolean;
  summary?: {
    scanned: number;
    reconciled: number;
    stillProcessing: number;
    failed: number;
    skipped: number;
  };
  error?: string;
}

const DEFAULT_BATCH_SIZE = 25;
const MAX_BATCH_SIZE = 100;
const DEFAULT_MIN_AGE_SECONDS = 60;

function positiveInt(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function getBatchSize(request: NextRequest): number {
  const queryBatch = positiveInt(request.nextUrl.searchParams.get("batch"));
  const envBatch = positiveInt(process.env.SOCIAL_RECONCILE_BATCH_SIZE ?? null);
  return Math.min(MAX_BATCH_SIZE, queryBatch ?? envBatch ?? DEFAULT_BATCH_SIZE);
}

function getMinAgeSeconds(request: NextRequest): number {
  const queryAge = positiveInt(request.nextUrl.searchParams.get("minAgeSeconds"));
  const envAge = positiveInt(process.env.SOCIAL_RECONCILE_MIN_AGE_SECONDS ?? null);
  return queryAge ?? envAge ?? DEFAULT_MIN_AGE_SECONDS;
}

export async function POST(
  request: NextRequest,
): Promise<NextResponse<ReconcileResponse>> {
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
    const now = Date.now();
    const batchSize = getBatchSize(request);
    const minAgeSeconds = getMinAgeSeconds(request);
    const updatedBefore = new Date(now - minAgeSeconds * 1000);

    const candidates = await listPublishingPostsForReconciliation({
      updatedBefore,
      limit: batchSize,
    });

    let reconciled = 0;
    let stillProcessing = 0;
    let failed = 0;
    let skipped = 0;

    for (const post of candidates) {
      if (post.disabled || post.requiresReauth || !post.platformPostId) {
        skipped += 1;
        continue;
      }

      const provider = getProvider(post.platform);
      if (!provider.getPostStatus) {
        skipped += 1;
        continue;
      }

      try {
        const accessToken = decryptToken(post.accessTokenEncrypted);
        const accessTokenSecret = post.accessTokenSecret
          ? decryptToken(post.accessTokenSecret)
          : undefined;

        const status = await provider.getPostStatus(
          post.platformUserId,
          accessToken,
          post.platformPostId,
          { accessTokenSecret },
        );

        if (status.status === "published") {
          await updatePostStatus(post.postId, "published", {
            platformPostId: status.platformPostId,
            platformPostUrl: status.platformPostUrl,
            publishedAt: new Date(),
            errorMessage: null,
          });
          await emitSocialEvent({
            workspaceId: post.workspaceId,
            eventType: "post.published",
            severity: "info",
            message: "Asynchronous publish completed successfully.",
            postId: post.postId,
            accountId: post.accountId,
            provider: post.platform,
            metadata: {
              platformPostId: status.platformPostId,
              platformPostUrl: status.platformPostUrl,
            },
          });
          logger.info("system", "Async social publish reconciled to published", {
            workspaceId: post.workspaceId,
            postId: post.postId,
            accountId: post.accountId,
            provider: post.platform,
            dispatchKey: `reconcile:${post.postId}`,
            workflowRunRef: null,
          });
          reconciled += 1;
          continue;
        }

        if (status.status === "failed") {
          const failureMessage =
            status.errorMessage ?? "Provider reported asynchronous publish failure.";
          await updatePostStatus(post.postId, "failed", {
            platformPostId: status.platformPostId,
            platformPostUrl: status.platformPostUrl,
            errorMessage: failureMessage,
          });
          await emitSocialEvent({
            workspaceId: post.workspaceId,
            eventType: "post.failed",
            severity: "error",
            message: failureMessage,
            userFacing: true,
            postId: post.postId,
            accountId: post.accountId,
            provider: post.platform,
          });
          logger.error("system", "Async social publish reconciled to failed", {
            workspaceId: post.workspaceId,
            postId: post.postId,
            accountId: post.accountId,
            provider: post.platform,
            dispatchKey: `reconcile:${post.postId}`,
            workflowRunRef: null,
            error: failureMessage,
          });
          failed += 1;
          continue;
        }

        await updatePostStatus(post.postId, "publishing", {
          platformPostId: status.platformPostId,
          platformPostUrl: status.platformPostUrl,
          errorMessage: null,
        });
        stillProcessing += 1;
      } catch (error) {
        const classified = provider.classifyError(error);

        if (classified.type === "refresh-token") {
          await markRequiresReauth(post.accountId);
          await updatePostStatus(post.postId, "failed", {
            errorMessage: "Authentication expired. Please reconnect your account.",
          });
          await emitSocialEvent({
            workspaceId: post.workspaceId,
            eventType: "account.reauth_required",
            severity: "error",
            message: "Authentication expired while reconciling publish status.",
            userFacing: true,
            postId: post.postId,
            accountId: post.accountId,
            provider: post.platform,
          });
          failed += 1;
          continue;
        }

        if (classified.type === "bad-body") {
          await updatePostStatus(post.postId, "failed", {
            errorMessage: classified.message,
          });
          await emitSocialEvent({
            workspaceId: post.workspaceId,
            eventType: "post.failed",
            severity: "error",
            message: classified.message,
            userFacing: true,
            postId: post.postId,
            accountId: post.accountId,
            provider: post.platform,
          });
          failed += 1;
          continue;
        }

        await updatePostStatus(post.postId, "publishing", {
          errorMessage: classified.message,
        });
        stillProcessing += 1;
      }
    }

    return NextResponse.json({
      success: true,
      summary: {
        scanned: candidates.length,
        reconciled,
        stillProcessing,
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
            : "Failed to reconcile processing social posts",
      },
      { status: 500 },
    );
  }
}
