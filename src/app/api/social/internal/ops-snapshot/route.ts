import { NextRequest, NextResponse } from "next/server";
import { and, eq, isNull, isNotNull, lte, sql } from "drizzle-orm";
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
    refreshLeases: {
      active: number;
      expired: number;
    };
  };
  error?: string;
}

function positiveInt(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
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
    const workspaceAccount = workspaceId ? eq(socialAccounts.workspaceId, workspaceId) : null;
    const workspaceEvent = workspaceId ? eq(socialEvents.workspaceId, workspaceId) : null;
    const workspaceWebhook = workspaceId ? eq(socialWebhooks.workspaceId, workspaceId) : null;
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

    const [
      postsTotal,
      postsQueued,
      postsPublishing,
      postsFailed,
      postsDraft,
      postsPublished,
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
    ] = await Promise.all([
      countRows(socialPosts, workspacePost ? [workspacePost] : []),
      countRows(socialPosts, workspacePost ? [workspacePost, eq(socialPosts.status, "queued")] : [eq(socialPosts.status, "queued")]),
      countRows(
        socialPosts,
        workspacePost ? [workspacePost, eq(socialPosts.status, "publishing")] : [eq(socialPosts.status, "publishing")],
      ),
      countRows(socialPosts, workspacePost ? [workspacePost, eq(socialPosts.status, "failed")] : [eq(socialPosts.status, "failed")]),
      countRows(socialPosts, workspacePost ? [workspacePost, eq(socialPosts.status, "draft")] : [eq(socialPosts.status, "draft")]),
      countRows(socialPosts, workspacePost ? [workspacePost, eq(socialPosts.status, "published")] : [eq(socialPosts.status, "published")]),
      countRows(socialAccounts, workspaceAccount ? [workspaceAccount] : []),
      countRows(
        socialAccounts,
        workspaceAccount ? [workspaceAccount, eq(socialAccounts.disabled, false)] : [eq(socialAccounts.disabled, false)],
      ),
      countRows(
        socialAccounts,
        workspaceAccount
          ? [workspaceAccount, eq(socialAccounts.requiresReauth, true)]
          : [eq(socialAccounts.requiresReauth, true)],
      ),
      countRows(
        socialAccounts,
        workspaceAccount
          ? [
              workspaceAccount,
              eq(socialAccounts.disabled, false),
              eq(socialAccounts.requiresReauth, false),
              isNotNull(socialAccounts.refreshTokenEncrypted),
              isNotNull(socialAccounts.tokenExpiresAt),
              lte(socialAccounts.tokenExpiresAt, expiringBefore),
            ]
          : [
              eq(socialAccounts.disabled, false),
              eq(socialAccounts.requiresReauth, false),
              isNotNull(socialAccounts.refreshTokenEncrypted),
              isNotNull(socialAccounts.tokenExpiresAt),
              lte(socialAccounts.tokenExpiresAt, expiringBefore),
            ],
      ),
      countRows(socialEvents, workspaceEvent ? [workspaceEvent] : []),
      countRows(
        socialEvents,
        workspaceEvent ? [workspaceEvent, eq(socialEvents.userFacing, true)] : [eq(socialEvents.userFacing, true)],
      ),
      countRows(
        socialEvents,
        workspaceEvent ? [workspaceEvent, isNull(socialEvents.readAt)] : [isNull(socialEvents.readAt)],
      ),
      countRows(socialWebhooks, workspaceWebhook ? [workspaceWebhook] : []),
      countRows(
        socialWebhooks,
        workspaceWebhook ? [workspaceWebhook, eq(socialWebhooks.enabled, true)] : [eq(socialWebhooks.enabled, true)],
      ),
      countRows(
        socialWebhookDeliveries,
        workspaceDelivery
          ? [workspaceDelivery, eq(socialWebhookDeliveries.status, "pending")]
          : [eq(socialWebhookDeliveries.status, "pending")],
      ),
      countRows(
        socialWebhookDeliveries,
        workspaceDelivery
          ? [workspaceDelivery, eq(socialWebhookDeliveries.status, "failed")]
          : [eq(socialWebhookDeliveries.status, "failed")],
      ),
      countRows(
        socialWebhookDeliveryDeadLetters,
        workspaceDeadLetter ? [workspaceDeadLetter] : [],
      ),
      countRows(
        socialDispatchRuns,
        workspaceDispatchRun
          ? [workspaceDispatchRun, eq(socialDispatchRuns.state, "pending")]
          : [eq(socialDispatchRuns.state, "pending")],
      ),
      countRows(
        socialDispatchRuns,
        workspaceDispatchRun
          ? [workspaceDispatchRun, eq(socialDispatchRuns.state, "claimed")]
          : [eq(socialDispatchRuns.state, "claimed")],
      ),
      countRows(
        socialDispatchRuns,
        workspaceDispatchRun
          ? [workspaceDispatchRun, eq(socialDispatchRuns.state, "failed")]
          : [eq(socialDispatchRuns.state, "failed")],
      ),
      countRows(
        socialTokenRefreshLeases,
        workspaceRefreshLease
          ? [workspaceRefreshLease, eq(socialTokenRefreshLeases.state, "active")]
          : [eq(socialTokenRefreshLeases.state, "active")],
      ),
      countRows(
        socialTokenRefreshLeases,
        workspaceRefreshLease
          ? [
              workspaceRefreshLease,
              eq(socialTokenRefreshLeases.state, "active"),
              lte(socialTokenRefreshLeases.leaseExpiresAt, now),
            ]
          : [
              eq(socialTokenRefreshLeases.state, "active"),
              lte(socialTokenRefreshLeases.leaseExpiresAt, now),
            ],
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
        refreshLeases: {
          active: refreshLeasesActive,
          expired: refreshLeasesExpired,
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

export async function GET(request: NextRequest): Promise<NextResponse<OpsSnapshotResponse>> {
  return buildSnapshot(request);
}

export async function POST(request: NextRequest): Promise<NextResponse<OpsSnapshotResponse>> {
  return buildSnapshot(request);
}
