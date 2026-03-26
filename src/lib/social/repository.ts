import { randomUUID } from "node:crypto";
import { and, desc, eq, gte, isNotNull, isNull, lt, lte, or, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import {
  socialAccounts,
  socialOAuthSelectionSessions,
  socialOAuthStates,
  socialPosts,
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
    errorMessage?: string;
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
