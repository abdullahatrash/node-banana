import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, gte, isNotNull, isNull, lt, lte, or, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import {
  socialAccounts,
  socialEvents,
  socialOAuthSelectionSessions,
  socialOAuthStates,
  socialWebhookDeliveries,
  socialWebhooks,
  socialPosts,
  type SocialEventSeverity,
  type SocialEventType,
  type SocialPlatform,
  type SocialPostStatus,
} from "@/lib/db/schema";

// ---------------------------------------------------------------------------
// Error classes
// ---------------------------------------------------------------------------

export class SocialAccountNotFoundError extends Error {
  constructor(id?: string) {
    super(id ? `Social account "${id}" not found.` : "Social account not found.");
    this.name = "SocialAccountNotFoundError";
  }
}

export class SocialPostNotFoundError extends Error {
  constructor(id?: string) {
    super(id ? `Social post "${id}" not found.` : "Social post not found.");
    this.name = "SocialPostNotFoundError";
  }
}

export class SocialPostStateTransitionError extends Error {
  currentStatus: SocialPostStatus;
  targetStatus: SocialPostStatus;

  constructor(currentStatus: SocialPostStatus, targetStatus: SocialPostStatus) {
    super(
      `Cannot transition post from "${currentStatus}" to "${targetStatus}".`,
    );
    this.name = "SocialPostStateTransitionError";
    this.currentStatus = currentStatus;
    this.targetStatus = targetStatus;
  }
}

export class OAuthStateNotFoundError extends Error {
  constructor() {
    super("OAuth state not found or already consumed.");
    this.name = "OAuthStateNotFoundError";
  }
}

export class OAuthStateExpiredError extends Error {
  constructor() {
    super("OAuth state has expired. Please try connecting again.");
    this.name = "OAuthStateExpiredError";
  }
}

export class OAuthSelectionSessionNotFoundError extends Error {
  constructor() {
    super("Selection session not found or already consumed.");
    this.name = "OAuthSelectionSessionNotFoundError";
  }
}

export class OAuthSelectionSessionExpiredError extends Error {
  constructor() {
    super("Selection session has expired. Please reconnect your account.");
    this.name = "OAuthSelectionSessionExpiredError";
  }
}

export class SocialWebhookNotFoundError extends Error {
  constructor(id?: string) {
    super(id ? `Social webhook "${id}" not found.` : "Social webhook not found.");
    this.name = "SocialWebhookNotFoundError";
  }
}

export class SocialEventNotFoundError extends Error {
  constructor(id?: string) {
    super(id ? `Social event "${id}" not found.` : "Social event not found.");
    this.name = "SocialEventNotFoundError";
  }
}

// ---------------------------------------------------------------------------
// OAuth States
// ---------------------------------------------------------------------------

export async function createOAuthState(input: {
  workspaceId: string;
  platform: SocialPlatform;
  state: string;
  codeVerifier?: string;
  metadata?: Record<string, unknown>;
  expiresAt: Date;
}) {
  const db = getDb();
  const id = `soauth_${randomUUID()}`;

  const [row] = await db
    .insert(socialOAuthStates)
    .values({
      id,
      workspaceId: input.workspaceId,
      platform: input.platform,
      state: input.state,
      codeVerifier: input.codeVerifier ?? null,
      metadata: input.metadata ?? null,
      expiresAt: input.expiresAt,
    })
    .returning();

  return row;
}

/**
 * Consume an OAuth state: look it up, validate expiry, then delete it.
 * This is atomic — the state can only be consumed once (replay protection).
 */
export async function consumeOAuthState(state: string) {
  const db = getDb();

  const [row] = await db
    .delete(socialOAuthStates)
    .where(eq(socialOAuthStates.state, state))
    .returning();

  if (!row) {
    throw new OAuthStateNotFoundError();
  }

  if (row.expiresAt < new Date()) {
    throw new OAuthStateExpiredError();
  }

  return row;
}

export async function cleanupExpiredOAuthStates() {
  const db = getDb();
  const rows = await db
    .delete(socialOAuthStates)
    .where(lt(socialOAuthStates.expiresAt, new Date()))
    .returning({ id: socialOAuthStates.id });
  return rows.length;
}

export async function createOAuthSelectionSession(input: {
  workspaceId: string;
  platform: SocialPlatform;
  accessTokenEncrypted: string;
  refreshTokenEncrypted?: string;
  accessTokenSecret?: string;
  tokenExpiresAt?: Date;
  createdByUserId: string;
  expiresAt: Date;
}) {
  const db = getDb();
  const id = `sosel_${randomUUID()}`;
  const [row] = await db
    .insert(socialOAuthSelectionSessions)
    .values({
      id,
      workspaceId: input.workspaceId,
      platform: input.platform,
      accessTokenEncrypted: input.accessTokenEncrypted,
      refreshTokenEncrypted: input.refreshTokenEncrypted ?? null,
      accessTokenSecret: input.accessTokenSecret ?? null,
      tokenExpiresAt: input.tokenExpiresAt ?? null,
      createdByUserId: input.createdByUserId,
      expiresAt: input.expiresAt,
    })
    .returning();

  return row;
}

export async function consumeOAuthSelectionSession(input: {
  selectionSessionId: string;
  workspaceId: string;
  platform: SocialPlatform;
}) {
  const db = getDb();
  const [row] = await db
    .delete(socialOAuthSelectionSessions)
    .where(
      and(
        eq(socialOAuthSelectionSessions.id, input.selectionSessionId),
        eq(socialOAuthSelectionSessions.workspaceId, input.workspaceId),
        eq(socialOAuthSelectionSessions.platform, input.platform),
      ),
    )
    .returning();

  if (!row) {
    throw new OAuthSelectionSessionNotFoundError();
  }

  if (row.expiresAt < new Date()) {
    throw new OAuthSelectionSessionExpiredError();
  }

  return row;
}

export async function cleanupExpiredOAuthSelectionSessions() {
  const db = getDb();
  const rows = await db
    .delete(socialOAuthSelectionSessions)
    .where(lt(socialOAuthSelectionSessions.expiresAt, new Date()))
    .returning({ id: socialOAuthSelectionSessions.id });

  return rows.length;
}

// ---------------------------------------------------------------------------
// Social Accounts
// ---------------------------------------------------------------------------

export async function upsertSocialAccount(input: {
  workspaceId: string;
  platform: SocialPlatform;
  platformUserId: string;
  displayName: string;
  username?: string;
  avatarUrl?: string;
  accessTokenEncrypted: string;
  refreshTokenEncrypted?: string;
  accessTokenSecret?: string;
  tokenExpiresAt?: Date;
  additionalSettings?: Record<string, unknown>;
  createdByUserId: string;
}) {
  const db = getDb();
  const id = `sacct_${randomUUID()}`;
  const now = new Date();

  const [row] = await db
    .insert(socialAccounts)
    .values({
      id,
      workspaceId: input.workspaceId,
      platform: input.platform,
      platformUserId: input.platformUserId,
      displayName: input.displayName,
      username: input.username ?? null,
      avatarUrl: input.avatarUrl ?? null,
      accessTokenEncrypted: input.accessTokenEncrypted,
      refreshTokenEncrypted: input.refreshTokenEncrypted ?? null,
      accessTokenSecret: input.accessTokenSecret ?? null,
      tokenExpiresAt: input.tokenExpiresAt ?? null,
      additionalSettings: input.additionalSettings ?? null,
      requiresReauth: false,
      disabled: false,
      createdByUserId: input.createdByUserId,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [
        socialAccounts.workspaceId,
        socialAccounts.platform,
        socialAccounts.platformUserId,
      ],
      set: {
        displayName: input.displayName,
        username: input.username ?? null,
        avatarUrl: input.avatarUrl ?? null,
        accessTokenEncrypted: input.accessTokenEncrypted,
        refreshTokenEncrypted: input.refreshTokenEncrypted ?? null,
        accessTokenSecret: input.accessTokenSecret ?? null,
        tokenExpiresAt: input.tokenExpiresAt ?? null,
        additionalSettings: input.additionalSettings ?? null,
        requiresReauth: false,
        disabled: false,
        updatedAt: now,
      },
    })
    .returning();

  return row;
}

export async function listSocialAccounts(workspaceId: string) {
  const db = getDb();
  return db
    .select()
    .from(socialAccounts)
    .where(eq(socialAccounts.workspaceId, workspaceId))
    .orderBy(desc(socialAccounts.createdAt));
}

export async function countActiveSocialAccounts(workspaceId: string) {
  const db = getDb();
  const [row] = await db
    .select({
      count: sql<number>`cast(count(*) as int)`,
    })
    .from(socialAccounts)
    .where(
      and(
        eq(socialAccounts.workspaceId, workspaceId),
        eq(socialAccounts.disabled, false),
      ),
    );

  return row?.count ?? 0;
}

export async function countActiveSocialWebhooks(workspaceId: string) {
  const db = getDb();
  const [row] = await db
    .select({
      count: sql<number>`cast(count(*) as int)`,
    })
    .from(socialWebhooks)
    .where(
      and(
        eq(socialWebhooks.workspaceId, workspaceId),
        eq(socialWebhooks.enabled, true),
      ),
    );

  return row?.count ?? 0;
}

export async function getSocialAccount(
  workspaceId: string,
  accountId: string,
) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(socialAccounts)
    .where(
      and(
        eq(socialAccounts.workspaceId, workspaceId),
        eq(socialAccounts.id, accountId),
      ),
    );

  if (!row) {
    throw new SocialAccountNotFoundError(accountId);
  }

  return row;
}

export async function getSocialAccountById(accountId: string) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(socialAccounts)
    .where(eq(socialAccounts.id, accountId));

  if (!row) {
    throw new SocialAccountNotFoundError(accountId);
  }

  return row;
}

export async function updateSocialAccountTokens(
  accountId: string,
  tokens: {
    accessTokenEncrypted: string;
    refreshTokenEncrypted?: string;
    tokenExpiresAt?: Date;
  },
) {
  const db = getDb();
  const [row] = await db
    .update(socialAccounts)
    .set({
      accessTokenEncrypted: tokens.accessTokenEncrypted,
      refreshTokenEncrypted: tokens.refreshTokenEncrypted ?? undefined,
      tokenExpiresAt: tokens.tokenExpiresAt ?? undefined,
      requiresReauth: false,
      updatedAt: new Date(),
    })
    .where(eq(socialAccounts.id, accountId))
    .returning();

  if (!row) {
    throw new SocialAccountNotFoundError(accountId);
  }

  return row;
}

export async function markRequiresReauth(accountId: string) {
  const db = getDb();
  await db
    .update(socialAccounts)
    .set({ requiresReauth: true, updatedAt: new Date() })
    .where(eq(socialAccounts.id, accountId));
}

export async function disconnectSocialAccount(
  workspaceId: string,
  accountId: string,
) {
  const db = getDb();

  // Verify ownership first
  const [existing] = await db
    .select({ id: socialAccounts.id })
    .from(socialAccounts)
    .where(
      and(
        eq(socialAccounts.workspaceId, workspaceId),
        eq(socialAccounts.id, accountId),
      ),
    );

  if (!existing) {
    throw new SocialAccountNotFoundError(accountId);
  }

  // Hard delete — cascades to associated posts
  await db.delete(socialAccounts).where(eq(socialAccounts.id, accountId));
}

// ---------------------------------------------------------------------------
// Social Posts
// ---------------------------------------------------------------------------

export async function createSocialPost(input: {
  workspaceId: string;
  socialAccountId: string;
  content?: string;
  mediaUrls?: Array<{ type: string; url: string; alt?: string }>;
  platformSettings?: Record<string, unknown>;
  scheduledAt?: Date;
  studioAssetId?: string;
  createdByUserId: string;
}) {
  const db = getDb();
  const id = `spost_${randomUUID()}`;
  const now = new Date();

  const [row] = await db
    .insert(socialPosts)
    .values({
      id,
      workspaceId: input.workspaceId,
      socialAccountId: input.socialAccountId,
      status: "draft",
      content: input.content ?? null,
      mediaUrls: input.mediaUrls ?? null,
      platformSettings: input.platformSettings ?? null,
      scheduledAt: input.scheduledAt ?? null,
      studioAssetId: input.studioAssetId ?? null,
      createdByUserId: input.createdByUserId,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  return row;
}

export async function listSocialPosts(
  workspaceId: string,
  filters?: {
    status?: SocialPostStatus;
    socialAccountId?: string;
    startDate?: Date;
    endDate?: Date;
    limit?: number;
    offset?: number;
  },
) {
  const db = getDb();
  const conditions = [eq(socialPosts.workspaceId, workspaceId)];

  if (filters?.status) {
    conditions.push(eq(socialPosts.status, filters.status));
  }
  if (filters?.socialAccountId) {
    conditions.push(eq(socialPosts.socialAccountId, filters.socialAccountId));
  }
  if (filters?.startDate) {
    conditions.push(gte(socialPosts.scheduledAt, filters.startDate));
  }
  if (filters?.endDate) {
    conditions.push(lte(socialPosts.scheduledAt, filters.endDate));
  }

  const query = db
    .select()
    .from(socialPosts)
    .where(and(...conditions))
    .orderBy(desc(socialPosts.createdAt));

  if (filters?.limit) {
    query.limit(filters.limit);
  }
  if (filters?.offset) {
    query.offset(filters.offset);
  }

  return query;
}

export async function listDueQueuedPosts(input?: {
  now?: Date;
  lockStaleBefore?: Date;
  limit?: number;
}) {
  const db = getDb();
  const now = input?.now ?? new Date();
  const lockStaleBefore =
    input?.lockStaleBefore ?? new Date(now.getTime() - 10 * 60 * 1000);
  const limit = input?.limit ?? 50;

  return db
    .select()
    .from(socialPosts)
    .where(
      and(
        eq(socialPosts.status, "queued"),
        or(
          isNull(socialPosts.dispatchStatus),
          eq(socialPosts.dispatchStatus, "pending"),
          eq(socialPosts.dispatchStatus, "retry_scheduled"),
        ),
        or(
          isNull(socialPosts.scheduledAt),
          lte(socialPosts.scheduledAt, now),
        ),
        or(
          isNull(socialPosts.nextDispatchAt),
          lte(socialPosts.nextDispatchAt, now),
        ),
        or(
          isNull(socialPosts.lockedAt),
          lt(socialPosts.lockedAt, lockStaleBefore),
        ),
      ),
    )
    .orderBy(desc(socialPosts.createdAt))
    .limit(limit);
}

export async function claimPostForDispatch(input: {
  postId: string;
  now?: Date;
  lockStaleBefore?: Date;
}) {
  const db = getDb();
  const now = input.now ?? new Date();
  const lockStaleBefore =
    input.lockStaleBefore ?? new Date(now.getTime() - 10 * 60 * 1000);

  const [row] = await db
    .update(socialPosts)
    .set({
      lockedAt: now,
      dispatchStatus: "pending",
      dispatchAttempts: sql`${socialPosts.dispatchAttempts} + 1`,
      updatedAt: now,
    })
    .where(
      and(
        eq(socialPosts.id, input.postId),
        eq(socialPosts.status, "queued"),
        or(
          isNull(socialPosts.dispatchStatus),
          eq(socialPosts.dispatchStatus, "pending"),
          eq(socialPosts.dispatchStatus, "retry_scheduled"),
        ),
        or(
          isNull(socialPosts.lockedAt),
          lt(socialPosts.lockedAt, lockStaleBefore),
        ),
      ),
    )
    .returning();

  return row ?? null;
}

export async function listStalePublishingPosts(input?: {
  staleBefore?: Date;
  limit?: number;
}) {
  const db = getDb();
  const staleBefore =
    input?.staleBefore ?? new Date(Date.now() - 30 * 60 * 1000);
  const limit = input?.limit ?? 50;

  return db
    .select()
    .from(socialPosts)
    .where(
      and(
        eq(socialPosts.status, "publishing"),
        lt(socialPosts.updatedAt, staleBefore),
      ),
    )
    .orderBy(desc(socialPosts.updatedAt))
    .limit(limit);
}

export async function listPublishingPostsForReconciliation(input?: {
  updatedBefore?: Date;
  limit?: number;
}) {
  const db = getDb();
  const updatedBefore =
    input?.updatedBefore ?? new Date(Date.now() - 60 * 1000);
  const limit = input?.limit ?? 50;

  return db
    .select({
      postId: socialPosts.id,
      workspaceId: socialPosts.workspaceId,
      socialAccountId: socialPosts.socialAccountId,
      platformPostId: socialPosts.platformPostId,
      platformPostUrl: socialPosts.platformPostUrl,
      updatedAt: socialPosts.updatedAt,
      accountId: socialAccounts.id,
      platform: socialAccounts.platform,
      platformUserId: socialAccounts.platformUserId,
      accessTokenEncrypted: socialAccounts.accessTokenEncrypted,
      accessTokenSecret: socialAccounts.accessTokenSecret,
      disabled: socialAccounts.disabled,
      requiresReauth: socialAccounts.requiresReauth,
    })
    .from(socialPosts)
    .innerJoin(socialAccounts, eq(socialPosts.socialAccountId, socialAccounts.id))
    .where(
      and(
        eq(socialPosts.status, "publishing"),
        isNotNull(socialPosts.platformPostId),
        lte(socialPosts.updatedAt, updatedBefore),
      ),
    )
    .orderBy(asc(socialPosts.updatedAt))
    .limit(limit);
}

export async function listExpiringSocialAccounts(input?: {
  expiresBefore?: Date;
  limit?: number;
}) {
  const db = getDb();
  const expiresBefore =
    input?.expiresBefore ?? new Date(Date.now() + 15 * 60 * 1000);
  const limit = input?.limit ?? 50;

  return db
    .select()
    .from(socialAccounts)
    .where(
      and(
        eq(socialAccounts.disabled, false),
        eq(socialAccounts.requiresReauth, false),
        isNotNull(socialAccounts.refreshTokenEncrypted),
        isNotNull(socialAccounts.tokenExpiresAt),
        lte(socialAccounts.tokenExpiresAt, expiresBefore),
      ),
    )
    .orderBy(desc(socialAccounts.tokenExpiresAt))
    .limit(limit);
}

export async function countSocialPostsCreatedInRange(
  workspaceId: string,
  start: Date,
  end: Date,
) {
  const db = getDb();
  const [row] = await db
    .select({
      count: sql<number>`cast(count(*) as int)`,
    })
    .from(socialPosts)
    .where(
      and(
        eq(socialPosts.workspaceId, workspaceId),
        gte(socialPosts.createdAt, start),
        lt(socialPosts.createdAt, end),
      ),
    );

  return row?.count ?? 0;
}

export async function getSocialPost(workspaceId: string, postId: string) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(socialPosts)
    .where(
      and(
        eq(socialPosts.workspaceId, workspaceId),
        eq(socialPosts.id, postId),
      ),
    );

  if (!row) {
    throw new SocialPostNotFoundError(postId);
  }

  return row;
}

export async function updateSocialPost(
  workspaceId: string,
  postId: string,
  data: {
    content?: string;
    mediaUrls?: Array<{ type: string; url: string; alt?: string }>;
    platformSettings?: Record<string, unknown>;
    scheduledAt?: Date | null;
  },
) {
  const db = getDb();

  // Verify post exists and is a draft
  const existing = await getSocialPost(workspaceId, postId);
  if (existing.status !== "draft") {
    throw new SocialPostStateTransitionError(existing.status, "draft");
  }

  const [row] = await db
    .update(socialPosts)
    .set({
      ...(data.content !== undefined && { content: data.content }),
      ...(data.mediaUrls !== undefined && { mediaUrls: data.mediaUrls }),
      ...(data.platformSettings !== undefined && {
        platformSettings: data.platformSettings,
      }),
      ...(data.scheduledAt !== undefined && { scheduledAt: data.scheduledAt }),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(socialPosts.workspaceId, workspaceId),
        eq(socialPosts.id, postId),
      ),
    )
    .returning();

  return row;
}

/**
 * Update post status — used by the publishing workflow.
 */
export async function updatePostStatus(
  postId: string,
  status: SocialPostStatus,
  extra?: {
    platformPostId?: string;
    platformPostUrl?: string;
    publishedAt?: Date;
    errorMessage?: string | null;
    retryCount?: number;
    dispatchStatus?: "pending" | "dispatched" | "retry_scheduled" | "failed" | null;
    dispatchAttempts?: number;
    workflowRunRef?: string | null;
    nextDispatchAt?: Date | null;
    lastDispatchError?: string | null;
    lockedAt?: Date | null;
  },
) {
  const db = getDb();

  const [row] = await db
    .update(socialPosts)
    .set({
      status,
      ...(extra?.platformPostId !== undefined && {
        platformPostId: extra.platformPostId,
      }),
      ...(extra?.platformPostUrl !== undefined && {
        platformPostUrl: extra.platformPostUrl,
      }),
      ...(extra?.publishedAt !== undefined && {
        publishedAt: extra.publishedAt,
      }),
      ...(extra?.errorMessage !== undefined && {
        errorMessage: extra.errorMessage,
      }),
      ...(extra?.retryCount !== undefined && {
        retryCount: extra.retryCount,
      }),
      ...(extra?.dispatchStatus !== undefined && {
        dispatchStatus: extra.dispatchStatus,
      }),
      ...(extra?.dispatchAttempts !== undefined && {
        dispatchAttempts: extra.dispatchAttempts,
      }),
      ...(extra?.workflowRunRef !== undefined && {
        workflowRunRef: extra.workflowRunRef,
      }),
      ...(extra?.nextDispatchAt !== undefined && {
        nextDispatchAt: extra.nextDispatchAt,
      }),
      ...(extra?.lastDispatchError !== undefined && {
        lastDispatchError: extra.lastDispatchError,
      }),
      ...(extra?.lockedAt !== undefined && {
        lockedAt: extra.lockedAt,
      }),
      updatedAt: new Date(),
    })
    .where(eq(socialPosts.id, postId))
    .returning();

  if (!row) {
    throw new SocialPostNotFoundError(postId);
  }

  return row;
}

export async function deleteSocialPost(workspaceId: string, postId: string) {
  const db = getDb();

  // Verify post exists and is in a deletable state
  const existing = await getSocialPost(workspaceId, postId);
  if (existing.status !== "draft" && existing.status !== "failed") {
    throw new SocialPostStateTransitionError(
      existing.status,
      "draft", // representing "deleted" intent
    );
  }

  await db
    .delete(socialPosts)
    .where(
      and(
        eq(socialPosts.workspaceId, workspaceId),
        eq(socialPosts.id, postId),
      ),
    );
}

export async function incrementRetryCount(postId: string) {
  const db = getDb();
  await db
    .update(socialPosts)
    .set({
      retryCount: sql`${socialPosts.retryCount} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(socialPosts.id, postId));
}

// ---------------------------------------------------------------------------
// Social observability: events + webhooks + deliveries
// ---------------------------------------------------------------------------

export async function createSocialWebhook(input: {
  workspaceId: string;
  targetUrl: string;
  signingSecretEncrypted: string;
  createdByUserId: string;
}) {
  const db = getDb();
  const id = `swh_${randomUUID()}`;
  const now = new Date();

  const [row] = await db
    .insert(socialWebhooks)
    .values({
      id,
      workspaceId: input.workspaceId,
      targetUrl: input.targetUrl,
      signingSecretEncrypted: input.signingSecretEncrypted,
      enabled: true,
      createdByUserId: input.createdByUserId,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  return row;
}

export async function listSocialWebhooks(workspaceId: string) {
  const db = getDb();
  return db
    .select()
    .from(socialWebhooks)
    .where(eq(socialWebhooks.workspaceId, workspaceId))
    .orderBy(desc(socialWebhooks.createdAt));
}

export async function getSocialWebhook(workspaceId: string, webhookId: string) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(socialWebhooks)
    .where(
      and(
        eq(socialWebhooks.workspaceId, workspaceId),
        eq(socialWebhooks.id, webhookId),
      ),
    );

  if (!row) {
    throw new SocialWebhookNotFoundError(webhookId);
  }

  return row;
}

export async function deleteSocialWebhook(workspaceId: string, webhookId: string) {
  const db = getDb();
  const [row] = await db
    .delete(socialWebhooks)
    .where(
      and(
        eq(socialWebhooks.workspaceId, workspaceId),
        eq(socialWebhooks.id, webhookId),
      ),
    )
    .returning();

  if (!row) {
    throw new SocialWebhookNotFoundError(webhookId);
  }

  return row;
}

export async function recordSocialEvent(input: {
  workspaceId: string;
  eventType: SocialEventType;
  severity?: SocialEventSeverity;
  message: string;
  userFacing?: boolean;
  readAt?: Date | null;
  postId?: string;
  accountId?: string;
  provider?: SocialPlatform;
  dispatchKey?: string;
  workflowRunRef?: string;
  metadata?: Record<string, unknown>;
  createdByUserId?: string;
}) {
  const db = getDb();
  const now = new Date();

  return db.transaction(async (tx) => {
    const eventId = `sevt_${randomUUID()}`;
    const [event] = await tx
      .insert(socialEvents)
      .values({
        id: eventId,
        workspaceId: input.workspaceId,
        eventType: input.eventType,
        severity: input.severity ?? "info",
        message: input.message,
        userFacing: input.userFacing ?? false,
        readAt: input.readAt ?? null,
        postId: input.postId ?? null,
        accountId: input.accountId ?? null,
        provider: input.provider ?? null,
        dispatchKey: input.dispatchKey ?? null,
        workflowRunRef: input.workflowRunRef ?? null,
        metadata: input.metadata ?? null,
        createdByUserId: input.createdByUserId ?? null,
        createdAt: now,
      })
      .returning();

    const activeWebhooks = await tx
      .select({ id: socialWebhooks.id })
      .from(socialWebhooks)
      .where(
        and(
          eq(socialWebhooks.workspaceId, input.workspaceId),
          eq(socialWebhooks.enabled, true),
        ),
      );

    if (activeWebhooks.length > 0) {
      await tx.insert(socialWebhookDeliveries).values(
        activeWebhooks.map((webhook) => ({
          id: `swhd_${randomUUID()}`,
          workspaceId: input.workspaceId,
          webhookId: webhook.id,
          eventId,
          status: "pending" as const,
          attemptCount: 0,
          nextAttemptAt: now,
          lockedAt: null,
          createdAt: now,
          updatedAt: now,
        })),
      );
    }

    return {
      event,
      queuedWebhookDeliveries: activeWebhooks.length,
    };
  });
}

export async function listSocialEvents(
  workspaceId: string,
  filters?: {
    userFacing?: boolean;
    unreadOnly?: boolean;
    limit?: number;
    offset?: number;
  },
) {
  const db = getDb();
  const conditions = [eq(socialEvents.workspaceId, workspaceId)];

  if (filters?.userFacing !== undefined) {
    conditions.push(eq(socialEvents.userFacing, filters.userFacing));
  }
  if (filters?.unreadOnly) {
    conditions.push(isNull(socialEvents.readAt));
  }

  const query = db
    .select()
    .from(socialEvents)
    .where(and(...conditions))
    .orderBy(desc(socialEvents.createdAt));

  if (filters?.limit) {
    query.limit(filters.limit);
  }
  if (filters?.offset) {
    query.offset(filters.offset);
  }

  return query;
}

export async function markSocialEventRead(workspaceId: string, eventId: string) {
  const db = getDb();
  const [row] = await db
    .update(socialEvents)
    .set({
      readAt: new Date(),
    })
    .where(
      and(
        eq(socialEvents.workspaceId, workspaceId),
        eq(socialEvents.id, eventId),
      ),
    )
    .returning();

  if (!row) {
    throw new SocialEventNotFoundError(eventId);
  }

  return row;
}

export async function listDueWebhookDeliveries(input?: {
  now?: Date;
  lockStaleBefore?: Date;
  limit?: number;
}) {
  const db = getDb();
  const now = input?.now ?? new Date();
  const lockStaleBefore =
    input?.lockStaleBefore ?? new Date(now.getTime() - 10 * 60 * 1000);
  const limit = input?.limit ?? 50;

  return db
    .select({
      deliveryId: socialWebhookDeliveries.id,
      workspaceId: socialWebhookDeliveries.workspaceId,
      webhookId: socialWebhookDeliveries.webhookId,
      eventId: socialWebhookDeliveries.eventId,
      attemptCount: socialWebhookDeliveries.attemptCount,
      targetUrl: socialWebhooks.targetUrl,
      signingSecretEncrypted: socialWebhooks.signingSecretEncrypted,
      eventType: socialEvents.eventType,
      message: socialEvents.message,
      userFacing: socialEvents.userFacing,
      severity: socialEvents.severity,
      postId: socialEvents.postId,
      accountId: socialEvents.accountId,
      provider: socialEvents.provider,
      dispatchKey: socialEvents.dispatchKey,
      workflowRunRef: socialEvents.workflowRunRef,
      metadata: socialEvents.metadata,
      eventCreatedAt: socialEvents.createdAt,
    })
    .from(socialWebhookDeliveries)
    .innerJoin(
      socialWebhooks,
      eq(socialWebhookDeliveries.webhookId, socialWebhooks.id),
    )
    .innerJoin(socialEvents, eq(socialWebhookDeliveries.eventId, socialEvents.id))
    .where(
      and(
        eq(socialWebhookDeliveries.status, "pending"),
        eq(socialWebhooks.enabled, true),
        or(
          isNull(socialWebhookDeliveries.nextAttemptAt),
          lte(socialWebhookDeliveries.nextAttemptAt, now),
        ),
        or(
          isNull(socialWebhookDeliveries.lockedAt),
          lt(socialWebhookDeliveries.lockedAt, lockStaleBefore),
        ),
      ),
    )
    .orderBy(
      asc(socialWebhookDeliveries.nextAttemptAt),
      desc(socialWebhookDeliveries.createdAt),
    )
    .limit(limit);
}

export async function claimWebhookDelivery(input: {
  deliveryId: string;
  now?: Date;
  lockStaleBefore?: Date;
}) {
  const db = getDb();
  const now = input.now ?? new Date();
  const lockStaleBefore =
    input.lockStaleBefore ?? new Date(now.getTime() - 10 * 60 * 1000);

  const [row] = await db
    .update(socialWebhookDeliveries)
    .set({
      lockedAt: now,
      attemptCount: sql`${socialWebhookDeliveries.attemptCount} + 1`,
      lastAttemptAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(socialWebhookDeliveries.id, input.deliveryId),
        eq(socialWebhookDeliveries.status, "pending"),
        or(
          isNull(socialWebhookDeliveries.lockedAt),
          lt(socialWebhookDeliveries.lockedAt, lockStaleBefore),
        ),
      ),
    )
    .returning();

  return row ?? null;
}

export async function markWebhookDeliverySuccess(input: {
  deliveryId: string;
  responseStatus?: number;
  responseBody?: string;
}) {
  const db = getDb();
  const [row] = await db
    .update(socialWebhookDeliveries)
    .set({
      status: "success",
      deliveredAt: new Date(),
      responseStatus: input.responseStatus ?? null,
      responseBody: input.responseBody ?? null,
      lastError: null,
      nextAttemptAt: null,
      lockedAt: null,
      updatedAt: new Date(),
    })
    .where(eq(socialWebhookDeliveries.id, input.deliveryId))
    .returning();

  return row ?? null;
}

export async function markWebhookDeliveryPendingRetry(input: {
  deliveryId: string;
  nextAttemptAt: Date;
  responseStatus?: number;
  responseBody?: string;
  lastError?: string;
}) {
  const db = getDb();
  const [row] = await db
    .update(socialWebhookDeliveries)
    .set({
      status: "pending",
      nextAttemptAt: input.nextAttemptAt,
      responseStatus: input.responseStatus ?? null,
      responseBody: input.responseBody ?? null,
      lastError: input.lastError ?? null,
      lockedAt: null,
      updatedAt: new Date(),
    })
    .where(eq(socialWebhookDeliveries.id, input.deliveryId))
    .returning();

  return row ?? null;
}

export async function markWebhookDeliveryFailed(input: {
  deliveryId: string;
  responseStatus?: number;
  responseBody?: string;
  lastError?: string;
}) {
  const db = getDb();
  const [row] = await db
    .update(socialWebhookDeliveries)
    .set({
      status: "failed",
      responseStatus: input.responseStatus ?? null,
      responseBody: input.responseBody ?? null,
      lastError: input.lastError ?? null,
      nextAttemptAt: null,
      lockedAt: null,
      updatedAt: new Date(),
    })
    .where(eq(socialWebhookDeliveries.id, input.deliveryId))
    .returning();

  return row ?? null;
}

export async function listWebhookDeliveriesForWorkspace(
  workspaceId: string,
  filters?: {
    webhookId?: string;
    limit?: number;
    offset?: number;
  },
) {
  const db = getDb();
  const conditions = [eq(socialWebhookDeliveries.workspaceId, workspaceId)];

  if (filters?.webhookId) {
    conditions.push(eq(socialWebhookDeliveries.webhookId, filters.webhookId));
  }

  const query = db
    .select({
      id: socialWebhookDeliveries.id,
      webhookId: socialWebhookDeliveries.webhookId,
      eventId: socialWebhookDeliveries.eventId,
      status: socialWebhookDeliveries.status,
      attemptCount: socialWebhookDeliveries.attemptCount,
      nextAttemptAt: socialWebhookDeliveries.nextAttemptAt,
      lastAttemptAt: socialWebhookDeliveries.lastAttemptAt,
      deliveredAt: socialWebhookDeliveries.deliveredAt,
      responseStatus: socialWebhookDeliveries.responseStatus,
      responseBody: socialWebhookDeliveries.responseBody,
      lastError: socialWebhookDeliveries.lastError,
      createdAt: socialWebhookDeliveries.createdAt,
      eventType: socialEvents.eventType,
      eventMessage: socialEvents.message,
    })
    .from(socialWebhookDeliveries)
    .innerJoin(socialEvents, eq(socialWebhookDeliveries.eventId, socialEvents.id))
    .where(and(...conditions))
    .orderBy(desc(socialWebhookDeliveries.createdAt));

  if (filters?.limit) {
    query.limit(filters.limit);
  }
  if (filters?.offset) {
    query.offset(filters.offset);
  }

  return query;
}
