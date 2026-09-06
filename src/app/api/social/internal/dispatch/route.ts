import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { start } from "workflow/api";
import { isDatabaseConfigured } from "@/lib/db";
import { ensureInternalSocialAuth } from "@/lib/social/internal-auth";
import { emitSocialEvent } from "@/lib/social/events";
import "@/lib/social/runtime-bootstrap";
import {
  claimPostForDispatch,
  claimSocialDispatchRun,
  finalizeSocialDispatchRun,
  getSocialAccountById,
  hasChainChildren,
  listDueQueuedPosts,
  updatePostStatus,
} from "@/lib/social/repository";
import { getProvider } from "@/lib/social/provider-registry";
import { resolveWorkflowRunRef } from "@/lib/social/workflow-utils";
import {
  publishPostChainWorkflow,
  publishPostWorkflow,
} from "@/../workflows/social-publish";
import { logger } from "@/utils/logger";
import { requiresGovernedPublishingPlan } from "@/lib/governance/publishing-route-guard";
import { parseGovernedPublishingMarker, PRODUCTION_SOCIAL_PUBLISHING_APPROVAL_ADMISSION } from "@/lib/agent-tools/social-publishing-approval";

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

function getProviderKey(platform: string | null | undefined): string | null {
  if (!platform) {
    return null;
  }

  try {
    return getProvider(platform).identifier;
  } catch {
    return null;
  }
}

async function handleDispatch(
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
    const activeByProvider = new Map<string, number>();

    for (const post of duePosts) {
      if (await requiresGovernedPublishingPlan(post.workspaceId)) {
        const publishingMarker = parseGovernedPublishingMarker(post.triggerSource);
        const governed = publishingMarker !== null && await PRODUCTION_SOCIAL_PUBLISHING_APPROVAL_ADMISSION.verifyConsumed({
          workspaceId: post.workspaceId,
          socialAccountId: post.socialAccountId,
          actorUserId: publishingMarker.consumingPrincipalId,
          triggerSource: post.triggerSource,
          content: post.content,
          mediaUrls: post.mediaUrls,
          stableMediaRefs: post.stableMediaRefs,
          platformSettings: post.platformSettings,
          scheduledAt: post.scheduledAt,
        });
        if (!governed) {
          await updatePostStatus(post.id, "failed", {
            dispatchStatus: "failed",
            errorMessage: "Governed Publishing Approval evidence is missing, stale, or does not match this exact post.",
            lastDispatchError: "governed_publishing_evidence_invalid",
            lockedAt: null,
          });
          failed += 1;
          continue;
        }
      }
      const claimed = await claimPostForDispatch({
        postId: post.id,
        now,
      });

      if (!claimed) {
        skipped += 1;
        continue;
      }

      const attempts = claimed.dispatchAttempts ?? 1;
      const publishingActor = parseGovernedPublishingMarker(claimed.triggerSource)?.consumingPrincipalId ?? claimed.createdByUserId ?? "system";
      const dispatchKey = `publish:${publishingActor}:${claimed.id}:${attempts}`;
      const dispatchClaimToken = randomUUID();
      let providerKey: string | null = null;

      if (claimed.socialAccountId) {
        try {
          const account = await getSocialAccountById(claimed.socialAccountId);
          providerKey = getProviderKey(account.platform);
          if (providerKey) {
            const provider = getProvider(providerKey);
            const active = activeByProvider.get(providerKey) ?? 0;
            if (active >= Math.max(1, provider.maxConcurrentJobs || 1)) {
              const nextDispatchAt = new Date(
                now.getTime() + backoffMs(attempts),
              );
              await updatePostStatus(claimed.id, "queued", {
                dispatchStatus: "retry_scheduled",
                errorMessage: "Provider concurrency limit reached.",
                workflowRunRef: null,
                nextDispatchAt,
                lastDispatchError: "provider_concurrency_gate",
                lockedAt: null,
              });
              logger.warn("system", "Internal social dispatch gated by provider concurrency", {
                workspaceId: claimed.workspaceId,
                postId: claimed.id,
                accountId: claimed.socialAccountId,
                provider: providerKey,
                dispatchKey,
                workflowRunRef: null,
              });
              retryScheduled += 1;
              continue;
            }
            activeByProvider.set(providerKey, active + 1);
          }
        } catch {
          providerKey = null;
        }
      }

      try {
        const dispatchRun = await claimSocialDispatchRun({
          workspaceId: claimed.workspaceId,
          dispatchKey,
          claimToken: dispatchClaimToken,
          kind: "post",
          postId: claimed.id,
          accountId: claimed.socialAccountId ?? null,
          provider: (providerKey as import("@/lib/db/schema").SocialPlatform | null) ?? null,
          payload: {
            postId: claimed.id,
            workspaceId: claimed.workspaceId,
          },
        });

        if (!dispatchRun || dispatchRun.claimToken !== dispatchClaimToken) {
          await updatePostStatus(claimed.id, "queued", {
            dispatchStatus: "dispatched",
            lockedAt: null,
          });
          skipped += 1;
          continue;
        }

        const isChainRoot =
          claimed.rootPostId === null &&
          ((claimed.kind ?? "post") === "chain_root" ||
            (await hasChainChildren(claimed.workspaceId, claimed.id)));
        const workflowRun = isChainRoot
          ? await start(publishPostChainWorkflow, [
              claimed.id,
              claimed.workspaceId,
            ])
          : await start(publishPostWorkflow, [claimed.id, claimed.workspaceId]);
        const workflowRunRef = resolveWorkflowRunRef(workflowRun, dispatchKey);

        await updatePostStatus(claimed.id, "queued", {
          dispatchStatus: "dispatched",
          workflowRunRef,
          nextDispatchAt: null,
          lastDispatchError: null,
          lockedAt: null,
        });
        await finalizeSocialDispatchRun({
          dispatchKey,
          state: "succeeded",
          result: { workflowRunRef },
        });
        logger.info("system", "Internal social dispatch succeeded", {
          workspaceId: claimed.workspaceId,
          postId: claimed.id,
          dispatchKey,
          workflowRunRef,
          chainWorkflow: isChainRoot,
        });
        dispatched += 1;
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : "Unknown workflow dispatch error";
        await finalizeSocialDispatchRun({
          dispatchKey,
          state: "failed",
          errorMessage,
          result: {
            attempts,
          },
        });

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
      } finally {
        if (providerKey) {
          const active = activeByProvider.get(providerKey) ?? 0;
          if (active <= 1) {
            activeByProvider.delete(providerKey);
          } else {
            activeByProvider.set(providerKey, active - 1);
          }
        }
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

export async function GET(
  request: NextRequest,
): Promise<NextResponse<DispatchResponse>> {
  return handleDispatch(request);
}

export async function POST(
  request: NextRequest,
): Promise<NextResponse<DispatchResponse>> {
  return handleDispatch(request);
}
