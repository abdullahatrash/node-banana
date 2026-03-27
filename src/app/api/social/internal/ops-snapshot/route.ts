import { NextRequest, NextResponse } from "next/server";
import { and, eq, isNull, isNotNull, lte, or, sql } from "drizzle-orm";
import { isDatabaseConfigured, getDb } from "@/lib/db";
import { ensureInternalSocialAuth } from "@/lib/social/internal-auth";
import {
  socialAccounts,
  socialDispatchRuns,
  socialEvents,
  socialPosts,
  socialTokenRefreshLeases,
  socialWebhookDeliveryDeadLetters,
  socialWebhookDeliveries,
  socialWebhooks,
} from "@/lib/db/schema";

interface OpsSnapshotResponse {
  success: boolean;
  snapshot?: {
    generatedAt: string;
    workspaceId: string | null;
    posts: {
      total: number;
      queued: number;
      publishing: number;
      failed: number;
      draft: number;
      published: number;
    };
    accounts: {
      total: number;
      active: number;
      requiresReauth: number;
      expiringSoon: number;
    };
    events: {
      total: number;
      userFacing: number;
      unread: number;
    };
    webhooks: {
      total: number;
      active: number;
    };
    deliveries: {
      pending: number;
      failed: number;
      deadLettered: number;
    };
    dispatch: {
      pending: number;
      claimed: number;
      failed: number;
    };
    queueDepth: {
      queuedPosts: number;
      queuedDueNowPosts: number;
      retryScheduledPosts: number;
      pendingWebhookDeliveries: number;
      pendingDispatchRuns: number;
      claimedDispatchRuns: number;
    };
    dispatchFailures: {
      failedDispatchRuns: number;
      failedPosts: number;
      retryScheduledPosts: number;
      failedWebhookDeliveries: number;
      deadLetteredDeliveries: number;
    };
    deadLetters: {
      total: number;
      deadLettered: number;
      replayRequested: number;
      replayed: number;
      replayFailed: number;
    };
    refreshLeases: {
      active: number;
      expired: number;
      released: number;
    };
    workflowLag: {
      oldestQueuedDuePostAgeSeconds: number | null;
      oldestPublishingPostAgeSeconds: number | null;
      oldestClaimedDispatchAgeSeconds: number | null;
      oldestPendingWebhookDeliveryAgeSeconds: number | null;
      oldestExpiredRefreshLeaseAgeSeconds: number | null;
    };
  };
  error?: string;
}

function positiveInt(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function scopeConditions(
  workspaceCondition: any | null,
  conditions: any[],
): any[] {
  return workspaceCondition ? [workspaceCondition, ...conditions] : conditions;
}

async function countRows(table: any, conditions: any[] = []): Promise<number> {
  const db = getDb();
  let query: any = db
    .select({
      count: sql<number>`cast(count(*) as int)`,
    })
    .from(table);

  if (conditions.length > 0) {
    query = query.where(and(...conditions));
  }

  const [row] = await query;
  return row?.count ?? 0;
}

async function getOldestTimestamp(
  table: any,
  column: any,
  conditions: any[] = [],
): Promise<Date | null> {
  const db = getDb();
  let query: any = db
    .select({
      oldest: sql<Date | string | null>`min(${column})`,
    })
    .from(table);

  if (conditions.length > 0) {
    query = query.where(and(...conditions));
  }

  const [row] = await query;
  const raw = row?.oldest ?? null;
  if (!raw) return null;
  const parsed = raw instanceof Date ? raw : new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function ageSecondsFromOldest(oldest: Date | null, now: Date): number | null {
  if (!oldest) return null;
  const ageMs = now.getTime() - oldest.getTime();
  return ageMs > 0 ? Math.floor(ageMs / 1000) : 0;
}

async function buildSnapshot(
  request: NextRequest,
): Promise<NextResponse<OpsSnapshotResponse>> {
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
    const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim() || null;
    const horizonMinutes = positiveInt(
      request.nextUrl.searchParams.get("horizonMinutes"),
    ) ?? 15;
    const now = new Date();
    const expiringBefore = new Date(now.getTime() + horizonMinutes * 60 * 1000);

    const workspacePost = workspaceId ? eq(socialPosts.workspaceId, workspaceId) : null;
    const workspaceAccount = workspaceId
      ? eq(socialAccounts.workspaceId, workspaceId)
      : null;
    const workspaceEvent = workspaceId ? eq(socialEvents.workspaceId, workspaceId) : null;
    const workspaceWebhook = workspaceId
      ? eq(socialWebhooks.workspaceId, workspaceId)
      : null;
    const workspaceDelivery = workspaceId
      ? eq(socialWebhookDeliveries.workspaceId, workspaceId)
      : null;
    const workspaceDeadLetter = workspaceId
      ? eq(socialWebhookDeliveryDeadLetters.workspaceId, workspaceId)
      : null;
    const workspaceDispatchRun = workspaceId
      ? eq(socialDispatchRuns.workspaceId, workspaceId)
      : null;
    const workspaceRefreshLease = workspaceId
      ? eq(socialTokenRefreshLeases.workspaceId, workspaceId)
      : null;

    const queuedDueNowConditions = [
      eq(socialPosts.status, "queued"),
      or(isNull(socialPosts.scheduledAt), lte(socialPosts.scheduledAt, now)),
      or(isNull(socialPosts.nextDispatchAt), lte(socialPosts.nextDispatchAt, now)),
    ];

    const retryScheduledConditions = [
      eq(socialPosts.status, "queued"),
      eq(socialPosts.dispatchStatus, "retry_scheduled"),
    ];

    const publishingConditions = [eq(socialPosts.status, "publishing")];
    const claimedDispatchConditions = [eq(socialDispatchRuns.state, "claimed")];
    const pendingDeliveryConditions = [
      eq(socialWebhookDeliveries.status, "pending"),
    ];
    const expiredLeaseConditions = [
      eq(socialTokenRefreshLeases.state, "active"),
      lte(socialTokenRefreshLeases.leaseExpiresAt, now),
    ];

    const [
      postsTotal,
      postsQueued,
      postsQueuedDueNow,
      postsPublishing,
      postsFailed,
      postsDraft,
      postsPublished,
      postsRetryScheduled,
      accountsTotal,
      accountsActive,
      accountsReauth,
      accountsExpiring,
      eventsTotal,
      eventsUserFacing,
      eventsUnread,
      webhooksTotal,
      webhooksActive,
      deliveriesPending,
      deliveriesFailed,
      deliveriesDeadLettered,
      dispatchPending,
      dispatchClaimed,
      dispatchFailed,
      refreshLeasesActive,
      refreshLeasesExpired,
      refreshLeasesReleased,
      deadLettersDeadLettered,
      deadLettersReplayRequested,
      deadLettersReplayed,
      deadLettersReplayFailed,
      oldestQueuedDuePost,
      oldestPublishingPost,
      oldestClaimedDispatch,
      oldestPendingDelivery,
      oldestExpiredLease,
    ] = await Promise.all([
      countRows(socialPosts, scopeConditions(workspacePost, [])),
      countRows(
        socialPosts,
        scopeConditions(workspacePost, [eq(socialPosts.status, "queued")]),
      ),
      countRows(
        socialPosts,
        scopeConditions(workspacePost, queuedDueNowConditions),
      ),
      countRows(socialPosts, scopeConditions(workspacePost, publishingConditions)),
      countRows(
        socialPosts,
        scopeConditions(workspacePost, [eq(socialPosts.status, "failed")]),
      ),
      countRows(
        socialPosts,
        scopeConditions(workspacePost, [eq(socialPosts.status, "draft")]),
      ),
      countRows(
        socialPosts,
        scopeConditions(workspacePost, [eq(socialPosts.status, "published")]),
      ),
      countRows(
        socialPosts,
        scopeConditions(workspacePost, retryScheduledConditions),
      ),
      countRows(socialAccounts, scopeConditions(workspaceAccount, [])),
      countRows(
        socialAccounts,
        scopeConditions(workspaceAccount, [eq(socialAccounts.disabled, false)]),
      ),
      countRows(
        socialAccounts,
        scopeConditions(workspaceAccount, [eq(socialAccounts.requiresReauth, true)]),
      ),
      countRows(
        socialAccounts,
        scopeConditions(workspaceAccount, [
          eq(socialAccounts.disabled, false),
          eq(socialAccounts.requiresReauth, false),
          isNotNull(socialAccounts.refreshTokenEncrypted),
          isNotNull(socialAccounts.tokenExpiresAt),
          lte(socialAccounts.tokenExpiresAt, expiringBefore),
        ]),
      ),
      countRows(socialEvents, scopeConditions(workspaceEvent, [])),
      countRows(
        socialEvents,
        scopeConditions(workspaceEvent, [eq(socialEvents.userFacing, true)]),
      ),
      countRows(
        socialEvents,
        scopeConditions(workspaceEvent, [isNull(socialEvents.readAt)]),
      ),
      countRows(socialWebhooks, scopeConditions(workspaceWebhook, [])),
      countRows(
        socialWebhooks,
        scopeConditions(workspaceWebhook, [eq(socialWebhooks.enabled, true)]),
      ),
      countRows(
        socialWebhookDeliveries,
        scopeConditions(workspaceDelivery, pendingDeliveryConditions),
      ),
      countRows(
        socialWebhookDeliveries,
        scopeConditions(workspaceDelivery, [eq(socialWebhookDeliveries.status, "failed")]),
      ),
      countRows(
        socialWebhookDeliveryDeadLetters,
        scopeConditions(workspaceDeadLetter, []),
      ),
      countRows(
        socialDispatchRuns,
        scopeConditions(workspaceDispatchRun, [eq(socialDispatchRuns.state, "pending")]),
      ),
      countRows(
        socialDispatchRuns,
        scopeConditions(workspaceDispatchRun, claimedDispatchConditions),
      ),
      countRows(
        socialDispatchRuns,
        scopeConditions(workspaceDispatchRun, [eq(socialDispatchRuns.state, "failed")]),
      ),
      countRows(
        socialTokenRefreshLeases,
        scopeConditions(workspaceRefreshLease, [eq(socialTokenRefreshLeases.state, "active")]),
      ),
      countRows(
        socialTokenRefreshLeases,
        scopeConditions(workspaceRefreshLease, expiredLeaseConditions),
      ),
      countRows(
        socialTokenRefreshLeases,
        scopeConditions(workspaceRefreshLease, [eq(socialTokenRefreshLeases.state, "released")]),
      ),
      countRows(
        socialWebhookDeliveryDeadLetters,
        scopeConditions(workspaceDeadLetter, [
          eq(socialWebhookDeliveryDeadLetters.replayState, "dead_lettered"),
        ]),
      ),
      countRows(
        socialWebhookDeliveryDeadLetters,
        scopeConditions(workspaceDeadLetter, [
          eq(socialWebhookDeliveryDeadLetters.replayState, "replay_requested"),
        ]),
      ),
      countRows(
        socialWebhookDeliveryDeadLetters,
        scopeConditions(workspaceDeadLetter, [
          eq(socialWebhookDeliveryDeadLetters.replayState, "replayed"),
        ]),
      ),
      countRows(
        socialWebhookDeliveryDeadLetters,
        scopeConditions(workspaceDeadLetter, [
          eq(socialWebhookDeliveryDeadLetters.replayState, "failed"),
        ]),
      ),
      getOldestTimestamp(
        socialPosts,
        socialPosts.createdAt,
        scopeConditions(workspacePost, queuedDueNowConditions),
      ),
      getOldestTimestamp(
        socialPosts,
        socialPosts.updatedAt,
        scopeConditions(workspacePost, publishingConditions),
      ),
      getOldestTimestamp(
        socialDispatchRuns,
        socialDispatchRuns.claimedAt,
        scopeConditions(workspaceDispatchRun, claimedDispatchConditions),
      ),
      getOldestTimestamp(
        socialWebhookDeliveries,
        socialWebhookDeliveries.createdAt,
        scopeConditions(workspaceDelivery, pendingDeliveryConditions),
      ),
      getOldestTimestamp(
        socialTokenRefreshLeases,
        socialTokenRefreshLeases.leaseExpiresAt,
        scopeConditions(workspaceRefreshLease, expiredLeaseConditions),
      ),
    ]);

    return NextResponse.json({
      success: true,
      snapshot: {
        generatedAt: now.toISOString(),
        workspaceId,
        posts: {
          total: postsTotal,
          queued: postsQueued,
          publishing: postsPublishing,
          failed: postsFailed,
          draft: postsDraft,
          published: postsPublished,
        },
        accounts: {
          total: accountsTotal,
          active: accountsActive,
          requiresReauth: accountsReauth,
          expiringSoon: accountsExpiring,
        },
        events: {
          total: eventsTotal,
          userFacing: eventsUserFacing,
          unread: eventsUnread,
        },
        webhooks: {
          total: webhooksTotal,
          active: webhooksActive,
        },
        deliveries: {
          pending: deliveriesPending,
          failed: deliveriesFailed,
          deadLettered: deliveriesDeadLettered,
        },
        dispatch: {
          pending: dispatchPending,
          claimed: dispatchClaimed,
          failed: dispatchFailed,
        },
        queueDepth: {
          queuedPosts: postsQueued,
          queuedDueNowPosts: postsQueuedDueNow,
          retryScheduledPosts: postsRetryScheduled,
          pendingWebhookDeliveries: deliveriesPending,
          pendingDispatchRuns: dispatchPending,
          claimedDispatchRuns: dispatchClaimed,
        },
        dispatchFailures: {
          failedDispatchRuns: dispatchFailed,
          failedPosts: postsFailed,
          retryScheduledPosts: postsRetryScheduled,
          failedWebhookDeliveries: deliveriesFailed,
          deadLetteredDeliveries: deliveriesDeadLettered,
        },
        deadLetters: {
          total: deliveriesDeadLettered,
          deadLettered: deadLettersDeadLettered,
          replayRequested: deadLettersReplayRequested,
          replayed: deadLettersReplayed,
          replayFailed: deadLettersReplayFailed,
        },
        refreshLeases: {
          active: refreshLeasesActive,
          expired: refreshLeasesExpired,
          released: refreshLeasesReleased,
        },
        workflowLag: {
          oldestQueuedDuePostAgeSeconds: ageSecondsFromOldest(oldestQueuedDuePost, now),
          oldestPublishingPostAgeSeconds: ageSecondsFromOldest(oldestPublishingPost, now),
          oldestClaimedDispatchAgeSeconds: ageSecondsFromOldest(oldestClaimedDispatch, now),
          oldestPendingWebhookDeliveryAgeSeconds: ageSecondsFromOldest(oldestPendingDelivery, now),
          oldestExpiredRefreshLeaseAgeSeconds: ageSecondsFromOldest(oldestExpiredLease, now),
        },
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error ? error.message : "Failed to build social ops snapshot",
      },
      { status: 500 },
    );
  }
}

export async function GET(
  request: NextRequest,
): Promise<NextResponse<OpsSnapshotResponse>> {
  return buildSnapshot(request);
}

export async function POST(
  request: NextRequest,
): Promise<NextResponse<OpsSnapshotResponse>> {
  return buildSnapshot(request);
}
