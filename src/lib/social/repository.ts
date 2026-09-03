import { randomUUID } from "node:crypto";
import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  or,
  sql,
} from "drizzle-orm";
import { getDb } from "@/lib/db";
import { canonicalDigest } from "@/lib/agent-tools/canonical";
import { isRecord } from "@/lib/social/utils";
import { preserveLinkedInAuthorKind } from "@/lib/social/linkedin-author-kind";
import {
  artifactContents,
  artifacts,
  assets,
  socialAutomationRules,
  socialAutomationTasks,
  socialAccounts,
  socialDispatchRuns,
  socialEvents,
  socialEventReads,
  socialNotificationPreferences,
  socialOAuthSelectionSessions,
  socialOAuthStates,
  socialTokenRefreshLeases,
  socialWebhookDeliveryDeadLetters,
  socialWebhookDeliveries,
  socialWebhookSubscriptions,
  socialWebhooks,
  socialPosts,
  type AutomationTaskState,
  type SocialDispatchRunState,
  type SocialEventSeverity,
  type SocialEventType,
  type SocialPlatform,
  type SocialPostStatus,
  type SocialTokenRefreshLeaseState,
  type SocialWebhookDeadLetterReplayState,
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

export class SocialPostMediaBindingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SocialPostMediaBindingError";
  }
}

export interface SocialPostMediaReference {
  resourceKind: "studio_asset" | "artifact";
  id: string;
  digest?: string;
}

export interface SocialPostStableMediaReference {
  resourceKind: "studio_asset" | "artifact";
  assetId: string;
  assetDigest: string;
  order: number;
  alt?: string;
}

function socialAssetDigest(asset: {
  type: string;
  mimeType: string | null;
  sizeBytes: number | null;
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
  checksum: string | null;
}): string {
  if (asset.checksum && /^sha256:[a-f0-9]{64}$/.test(asset.checksum)) return asset.checksum;
  return canonicalDigest({ type: asset.type, mimeType: asset.mimeType, sizeBytes: asset.sizeBytes, width: asset.width, height: asset.height, durationSeconds: asset.durationSeconds });
}

export function bindStableSocialMedia(input: {
  mediaUrls: Array<{ type: string; url: string; alt?: string }>;
  references: SocialPostMediaReference[];
  resources: ReadonlyMap<string, { resourceKind: "studio_asset" | "artifact"; id: string; digest: string; type: string }>;
}): SocialPostStableMediaReference[] {
  if (input.mediaUrls.length !== input.references.length) throw new SocialPostMediaBindingError("Every social media item requires one ordered canonical media reference.");
  if (new Set(input.references.map((reference) => `${reference.resourceKind}:${reference.id}`)).size !== input.references.length) throw new SocialPostMediaBindingError("A social media resource may appear only once in a post.");
  return input.references.map((reference, order) => {
    const resource = input.resources.get(`${reference.resourceKind}:${reference.id}`);
    if (!resource) throw new SocialPostMediaBindingError(`Canonical media resource is unavailable in this Workspace: ${reference.id}.`);
    if (resource.type !== input.mediaUrls[order]?.type) throw new SocialPostMediaBindingError(`Media type does not match canonical resource ${reference.id}.`);
    if (reference.digest && reference.digest !== resource.digest) throw new SocialPostMediaBindingError(`Media digest does not match canonical resource ${reference.id}.`);
    return { resourceKind: reference.resourceKind, assetId: reference.id, assetDigest: resource.digest, order, ...(input.mediaUrls[order]?.alt ? { alt: input.mediaUrls[order].alt } : {}) };
  });
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

export class SocialDispatchRunNotFoundError extends Error {
  constructor(dispatchKey?: string) {
    super(
      dispatchKey
        ? `Social dispatch run "${dispatchKey}" not found.`
        : "Social dispatch run not found.",
    );
    this.name = "SocialDispatchRunNotFoundError";
  }
}

export class SocialTokenRefreshLeaseNotFoundError extends Error {
  constructor(id?: string) {
    super(
      id
        ? `Social token refresh lease "${id}" not found.`
        : "Social token refresh lease not found.",
    );
    this.name = "SocialTokenRefreshLeaseNotFoundError";
  }
}

export class SocialEventReadNotFoundError extends Error {
  constructor(id?: string) {
    super(
      id
        ? `Social event read "${id}" not found.`
        : "Social event read not found.",
    );
    this.name = "SocialEventReadNotFoundError";
  }
}

export class SocialNotificationPreferencesNotFoundError extends Error {
  constructor(userId?: string) {
    super(
      userId
        ? `Social notification preferences for user "${userId}" not found.`
        : "Social notification preferences not found.",
    );
    this.name = "SocialNotificationPreferencesNotFoundError";
  }
}

export class SocialWebhookSubscriptionNotFoundError extends Error {
  constructor(id?: string) {
    super(
      id
        ? `Social webhook subscription "${id}" not found.`
        : "Social webhook subscription not found.",
    );
    this.name = "SocialWebhookSubscriptionNotFoundError";
  }
}

export class SocialWebhookDeliveryDeadLetterNotFoundError extends Error {
  constructor(id?: string) {
    super(
      id
        ? `Social webhook dead letter "${id}" not found.`
        : "Social webhook dead letter not found.",
    );
    this.name = "SocialWebhookDeliveryDeadLetterNotFoundError";
  }
}

export class AutomationRuleNotFoundError extends Error {
  constructor(id?: string) {
    super(id ? `Automation rule "${id}" not found.` : "Automation rule not found.");
    this.name = "AutomationRuleNotFoundError";
  }
}

export class AutomationTaskNotFoundError extends Error {
  constructor(id?: string) {
    super(id ? `Automation task "${id}" not found.` : "Automation task not found.");
    this.name = "AutomationTaskNotFoundError";
  }
}

type SocialWebhookSubscriptionFilters = {
  eventTypes?: SocialEventType[];
  severities?: SocialEventSeverity[];
  platforms?: SocialPlatform[];
  userFacing?: boolean;
  postIds?: string[];
  accountIds?: string[];
  dispatchKeys?: string[];
  rootPostIds?: string[];
  kinds?: string[];
  triggerSources?: string[];
  metadata?: Record<string, unknown>;
};

type SocialWebhookMatchInput = {
  workspaceId: string;
  eventType?: SocialEventType;
  severity?: SocialEventSeverity;
  platform?: SocialPlatform;
  userFacing?: boolean;
  postId?: string | null;
  accountId?: string | null;
  dispatchKey?: string | null;
  rootPostId?: string | null;
  kind?: string | null;
  triggerSource?: string | null;
  metadata?: Record<string, unknown> | null;
  webhookId?: string;
};

function includesFilter<T extends string>(
  filterValue: unknown,
  actual: T | null | undefined,
): boolean {
  if (filterValue == null) {
    return true;
  }

  if (!Array.isArray(filterValue)) {
    return filterValue === actual;
  }

  return actual !== undefined && actual !== null && filterValue.includes(actual);
}

function matchesMetadataFilter(
  expected: Record<string, unknown> | undefined,
  actual: Record<string, unknown> | null | undefined,
): boolean {
  if (!expected) {
    return true;
  }

  if (!actual) {
    return false;
  }

  return Object.entries(expected).every(([key, value]) => {
    if (Array.isArray(value)) {
      return Array.isArray(actual[key])
        ? value.every((item) => (actual[key] as unknown[]).includes(item))
        : false;
    }

    if (isRecord(value)) {
      return isRecord(actual[key]) && matchesMetadataFilter(value, actual[key]);
    }

    return actual[key] === value;
  });
}

function matchesWebhookSubscriptionFilter(
  filters: unknown,
  event: SocialWebhookMatchInput,
): boolean {
  if (!isRecord(filters)) {
    return true;
  }

  const typedFilters = filters as SocialWebhookSubscriptionFilters;

  if (
    !includesFilter(typedFilters.eventTypes, event.eventType) ||
    !includesFilter(typedFilters.severities, event.severity) ||
    !includesFilter(typedFilters.platforms, event.platform) ||
    !includesFilter(typedFilters.postIds, event.postId ?? null) ||
    !includesFilter(typedFilters.accountIds, event.accountId ?? null) ||
    !includesFilter(typedFilters.dispatchKeys, event.dispatchKey ?? null) ||
    !includesFilter(typedFilters.rootPostIds, event.rootPostId ?? null) ||
    !includesFilter(typedFilters.kinds, event.kind ?? null) ||
    !includesFilter(typedFilters.triggerSources, event.triggerSource ?? null)
  ) {
    return false;
  }

  if (
    typedFilters.userFacing !== undefined &&
    typedFilters.userFacing !== event.userFacing
  ) {
    return false;
  }

  return matchesMetadataFilter(typedFilters.metadata, event.metadata ?? undefined);
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

export async function getOAuthStateByState(state: string) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(socialOAuthStates)
    .where(eq(socialOAuthStates.state, state));

  return row ?? null;
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

export async function getOAuthSelectionSession(input: {
  selectionSessionId: string;
  workspaceId: string;
  platform: SocialPlatform;
}) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(socialOAuthSelectionSessions)
    .where(
      and(
        eq(socialOAuthSelectionSessions.id, input.selectionSessionId),
        eq(socialOAuthSelectionSessions.workspaceId, input.workspaceId),
        eq(socialOAuthSelectionSessions.platform, input.platform),
      ),
    );

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

export async function updateSocialAccount(
  workspaceId: string,
  accountId: string,
  data: {
    displayName?: string;
    disabled?: boolean;
    additionalSettings?: Record<string, unknown> | null;
  },
) {
  const db = getDb();
  let additionalSettings = data.additionalSettings;
  if (data.additionalSettings !== undefined) {
    const [current] = await db
      .select({
        platform: socialAccounts.platform,
        additionalSettings: socialAccounts.additionalSettings,
      })
      .from(socialAccounts)
      .where(
        and(
          eq(socialAccounts.workspaceId, workspaceId),
          eq(socialAccounts.id, accountId),
        ),
      )
      .limit(1);
    if (!current) throw new SocialAccountNotFoundError(accountId);
    if (current.platform === "linkedin") {
      additionalSettings = preserveLinkedInAuthorKind(
        current.additionalSettings,
        data.additionalSettings,
      );
    }
  }
  const [row] = await db
    .update(socialAccounts)
    .set({
      ...(data.displayName !== undefined && { displayName: data.displayName }),
      ...(data.disabled !== undefined && { disabled: data.disabled }),
      ...(data.additionalSettings !== undefined && {
        additionalSettings,
      }),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(socialAccounts.workspaceId, workspaceId),
        eq(socialAccounts.id, accountId),
      ),
    )
    .returning();

  if (!row) {
    throw new SocialAccountNotFoundError(accountId);
  }

  return row;
}

export async function countSocialPostsForAccount(
  workspaceId: string,
  accountId: string,
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
        eq(socialPosts.socialAccountId, accountId),
      ),
    );

  return row?.count ?? 0;
}

// ---------------------------------------------------------------------------
// Social Posts
// ---------------------------------------------------------------------------

async function resolveStableSocialMedia(input: {
  workspaceId: string;
  mediaUrls: Array<{ type: string; url: string; alt?: string }>;
  references: SocialPostMediaReference[];
}): Promise<SocialPostStableMediaReference[]> {
  if (input.mediaUrls.length === 0 && input.references.length === 0) return [];
  const db = getDb();
  const assetIds = input.references.filter((reference) => reference.resourceKind === "studio_asset").map((reference) => reference.id);
  const artifactIds = input.references.filter((reference) => reference.resourceKind === "artifact").map((reference) => reference.id);
  const [assetRows, artifactRows] = await Promise.all([
    assetIds.length
      ? db.select().from(assets).where(and(eq(assets.workspaceId, input.workspaceId), inArray(assets.id, assetIds), isNull(assets.deletedAt)))
      : [],
    artifactIds.length
      ? db.select({ artifact: artifacts, content: artifactContents }).from(artifacts).innerJoin(artifactContents, and(eq(artifactContents.workspaceId, artifacts.workspaceId), eq(artifactContents.digest, artifacts.contentDigest))).where(and(eq(artifacts.workspaceId, input.workspaceId), inArray(artifacts.id, artifactIds), isNull(artifacts.deletedAt)))
      : [],
  ]);
  const resources = new Map<string, { resourceKind: "studio_asset" | "artifact"; id: string; digest: string; type: string }>();
  for (const asset of assetRows) resources.set(`studio_asset:${asset.id}`, { resourceKind: "studio_asset", id: asset.id, digest: socialAssetDigest(asset), type: asset.type });
  for (const { artifact, content } of artifactRows) resources.set(`artifact:${artifact.id}`, { resourceKind: "artifact", id: artifact.id, digest: content.digest, type: content.kind });
  return bindStableSocialMedia({ mediaUrls: input.mediaUrls, references: input.references, resources });
}

export async function createSocialPost(input: {
  workspaceId: string;
  socialAccountId: string;
  content?: string;
  mediaUrls?: Array<{ type: string; url: string; alt?: string }>;
  platformSettings?: Record<string, unknown>;
  scheduledAt?: Date;
  rootPostId?: string | null;
  kind?: string;
  delaySeconds?: number | null;
  position?: number | null;
  sourceTemplatePostId?: string | null;
  triggerSource?: string | null;
  parentPostId?: string | null;
  studioAssetId?: string;
  mediaReferences?: SocialPostMediaReference[];
  createdByUserId: string;
}) {
  const db = getDb();
  const id = `spost_${randomUUID()}`;
  const now = new Date();
  const mediaUrls = input.mediaUrls ?? [];
  const references = input.mediaReferences ?? (input.studioAssetId ? [{ resourceKind: "studio_asset" as const, id: input.studioAssetId }] : []);
  const stableMediaRefs = await resolveStableSocialMedia({ workspaceId: input.workspaceId, mediaUrls, references });
  const firstStudioAssetId = stableMediaRefs.find((reference) => reference.resourceKind === "studio_asset")?.assetId ?? null;

  const [row] = await db
    .insert(socialPosts)
    .values({
      id,
      workspaceId: input.workspaceId,
      socialAccountId: input.socialAccountId,
      status: "draft",
      rootPostId: input.rootPostId ?? null,
      content: input.content ?? null,
      mediaUrls: mediaUrls.length ? mediaUrls : null,
      platformSettings: input.platformSettings ?? null,
      scheduledAt: input.scheduledAt ?? null,
      kind: input.kind ?? "post",
      delaySeconds: input.delaySeconds ?? null,
      position: input.position ?? null,
      sourceTemplatePostId: input.sourceTemplatePostId ?? null,
      triggerSource: input.triggerSource ?? null,
      parentPostId: input.parentPostId ?? null,
      studioAssetId: firstStudioAssetId,
      stableMediaRefs,
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
    rootPostId?: string;
    parentPostId?: string;
    kind?: string;
    sourceTemplatePostId?: string;
    triggerSource?: string;
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
  if (filters?.rootPostId) {
    conditions.push(eq(socialPosts.rootPostId, filters.rootPostId));
  }
  if (filters?.parentPostId) {
    conditions.push(eq(socialPosts.parentPostId, filters.parentPostId));
  }
  if (filters?.kind) {
    conditions.push(eq(socialPosts.kind, filters.kind));
  }
  if (filters?.sourceTemplatePostId) {
    conditions.push(
      eq(socialPosts.sourceTemplatePostId, filters.sourceTemplatePostId),
    );
  }
  if (filters?.triggerSource) {
    conditions.push(eq(socialPosts.triggerSource, filters.triggerSource));
  }
  const calendarDate = sql<Date>`coalesce(${socialPosts.scheduledAt}, ${socialPosts.publishedAt}, ${socialPosts.createdAt})`;
  if (filters?.startDate) {
    conditions.push(gte(calendarDate, filters.startDate));
  }
  if (filters?.endDate) {
    conditions.push(lte(calendarDate, filters.endDate));
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

export async function hasChainChildren(
  workspaceId: string,
  rootPostId: string,
) {
  const db = getDb();
  const rows = await db
    .select({ id: socialPosts.id })
    .from(socialPosts)
    .where(
      and(
        eq(socialPosts.workspaceId, workspaceId),
        eq(socialPosts.rootPostId, rootPostId),
      ),
    )
    .limit(1);

  return rows.length > 0;
}

export async function listOrderedChainChildren(
  workspaceId: string,
  rootPostId: string,
) {
  const db = getDb();
  const rows = await db
    .select()
    .from(socialPosts)
    .where(
      and(
        eq(socialPosts.workspaceId, workspaceId),
        eq(socialPosts.rootPostId, rootPostId),
      ),
    );

  return rows.sort((a, b) => {
    const positionA = a.position ?? Number.MAX_SAFE_INTEGER;
    const positionB = b.position ?? Number.MAX_SAFE_INTEGER;
    if (positionA !== positionB) {
      return positionA - positionB;
    }

    const createdAtA = a.createdAt?.getTime?.() ?? 0;
    const createdAtB = b.createdAt?.getTime?.() ?? 0;
    if (createdAtA !== createdAtB) {
      return createdAtA - createdAtB;
    }

    return a.id.localeCompare(b.id);
  });
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

export async function listQueuedDispatchedPostsMissingWorkflow(input?: {
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
        eq(socialPosts.dispatchStatus, "dispatched"),
        isNull(socialPosts.workflowRunRef),
        or(isNull(socialPosts.scheduledAt), lte(socialPosts.scheduledAt, now)),
        or(isNull(socialPosts.nextDispatchAt), lte(socialPosts.nextDispatchAt, now)),
        or(isNull(socialPosts.lockedAt), lt(socialPosts.lockedAt, lockStaleBefore)),
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

export async function claimQueuedDispatchedPostForRecovery(input: {
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
        eq(socialPosts.dispatchStatus, "dispatched"),
        isNull(socialPosts.workflowRunRef),
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

export async function socialPostBelongsToWorkspace(
  workspaceId: string,
  postId: string,
) {
  const db = getDb();
  const [row] = await db
    .select({ id: socialPosts.id })
    .from(socialPosts)
    .where(and(eq(socialPosts.workspaceId, workspaceId), eq(socialPosts.id, postId)))
    .limit(1);

  return Boolean(row);
}

export async function updateSocialPost(
  workspaceId: string,
  postId: string,
  data: {
    content?: string;
    mediaUrls?: Array<{ type: string; url: string; alt?: string }>;
    mediaReferences?: SocialPostMediaReference[];
    platformSettings?: Record<string, unknown>;
    scheduledAt?: Date | null;
    rootPostId?: string | null;
    kind?: string;
    delaySeconds?: number | null;
    position?: number | null;
    sourceTemplatePostId?: string | null;
    triggerSource?: string | null;
    parentPostId?: string | null;
  },
) {
  const db = getDb();

  // Verify post exists
  const existing = await getSocialPost(workspaceId, postId);
  const onlyScheduledAtUpdate =
    data.scheduledAt !== undefined &&
    data.content === undefined &&
    data.mediaUrls === undefined &&
    data.platformSettings === undefined &&
    data.rootPostId === undefined &&
    data.kind === undefined &&
    data.delaySeconds === undefined &&
    data.position === undefined &&
    data.sourceTemplatePostId === undefined &&
    data.triggerSource === undefined &&
    data.parentPostId === undefined;

  const canEditAsDraft = existing.status === "draft";
  const canRescheduleQueued =
    onlyScheduledAtUpdate &&
    (existing.status === "queued" ||
      existing.status === "failed");

  if (!canEditAsDraft && !canRescheduleQueued) {
    throw new SocialPostStateTransitionError(existing.status, "draft");
  }

  const isCalendarReschedule = onlyScheduledAtUpdate && data.scheduledAt;
  const shouldRefreshQueuedDispatch =
    isCalendarReschedule && existing.status === "queued";
  const stableMediaRefs = data.mediaUrls === undefined
    ? undefined
    : await resolveStableSocialMedia({ workspaceId, mediaUrls: data.mediaUrls, references: data.mediaReferences ?? [] });
  const firstStudioAssetId = stableMediaRefs?.find((reference) => reference.resourceKind === "studio_asset")?.assetId ?? null;

  const [row] = await db
    .update(socialPosts)
    .set({
      ...(data.content !== undefined && { content: data.content }),
      ...(data.mediaUrls !== undefined && { mediaUrls: data.mediaUrls }),
      ...(stableMediaRefs !== undefined && { stableMediaRefs, studioAssetId: firstStudioAssetId }),
      ...(data.platformSettings !== undefined && {
        platformSettings: data.platformSettings,
      }),
      ...(data.scheduledAt !== undefined && { scheduledAt: data.scheduledAt }),
      ...(shouldRefreshQueuedDispatch
        ? {
            dispatchStatus: "pending" as const,
            workflowRunRef: null,
            nextDispatchAt: data.scheduledAt,
            lastDispatchError: null,
            lockedAt: null,
          }
        : {}),
      ...(data.rootPostId !== undefined && { rootPostId: data.rootPostId }),
      ...(data.kind !== undefined && { kind: data.kind }),
      ...(data.delaySeconds !== undefined && { delaySeconds: data.delaySeconds }),
      ...(data.position !== undefined && { position: data.position }),
      ...(data.sourceTemplatePostId !== undefined && {
        sourceTemplatePostId: data.sourceTemplatePostId,
      }),
      ...(data.triggerSource !== undefined && {
        triggerSource: data.triggerSource,
      }),
      ...(data.parentPostId !== undefined && {
        parentPostId: data.parentPostId,
      }),
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
 * Re-reads and fences the exact row immediately before the irreversible
 * provider effect. Normal editors cannot mutate a publishing row, while the
 * refreshed lock prevents the stuck-run sweeper from requeueing this active
 * provider attempt.
 */
export async function claimSocialPostProviderEffect(
  workspaceId: string,
  postId: string,
) {
  const db = getDb();
  return db.transaction(async (tx) => {
    const [post] = await tx
      .select()
      .from(socialPosts)
      .where(and(eq(socialPosts.workspaceId, workspaceId), eq(socialPosts.id, postId)))
      .for("update");
    if (!post) throw new SocialPostNotFoundError(postId);
    if (post.status !== "publishing") {
      throw new SocialPostStateTransitionError(post.status, "publishing");
    }
    const claimedAt = new Date();
    const [claimed] = await tx
      .update(socialPosts)
      .set({ lockedAt: claimedAt, updatedAt: claimedAt })
      .where(and(
        eq(socialPosts.workspaceId, workspaceId),
        eq(socialPosts.id, postId),
        eq(socialPosts.status, "publishing"),
      ))
      .returning();
    if (!claimed) throw new SocialPostStateTransitionError(post.status, "publishing");
    return claimed;
  });
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
    scheduledAt?: Date | null;
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
      ...(extra?.scheduledAt !== undefined && {
        scheduledAt: extra.scheduledAt,
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
  if (existing.status === "published") {
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
// Social parity primitives: dispatch runs, refresh leases, reads, prefs
// ---------------------------------------------------------------------------

export async function claimSocialDispatchRun(input: {
  workspaceId: string;
  dispatchKey: string;
  claimToken?: string;
  staleClaimBefore?: Date;
  kind?: string;
  postId?: string | null;
  eventId?: string | null;
  accountId?: string | null;
  provider?: SocialPlatform | null;
  payload?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
  now?: Date;
}) {
  const db = getDb();
  const now = input.now ?? new Date();
  const claimToken = input.claimToken ?? randomUUID();
  const staleClaimBefore =
    input.staleClaimBefore ?? new Date(now.getTime() - 10 * 60 * 1000);
  const id = `sdrun_${randomUUID()}`;

  const [inserted] = await db
    .insert(socialDispatchRuns)
    .values({
      id,
      workspaceId: input.workspaceId,
      dispatchKey: input.dispatchKey,
      state: "claimed",
      kind: input.kind ?? "post",
      postId: input.postId ?? null,
      eventId: input.eventId ?? null,
      accountId: input.accountId ?? null,
      provider: input.provider ?? null,
      claimToken,
      claimedAt: now,
      finalizedAt: null,
      errorMessage: null,
      result: null,
      payload: input.payload ?? null,
      metadata: input.metadata ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: socialDispatchRuns.dispatchKey,
      set: {
        workspaceId: input.workspaceId,
        state: "claimed",
        kind: input.kind ?? "post",
        postId: input.postId ?? null,
        eventId: input.eventId ?? null,
        accountId: input.accountId ?? null,
        provider: input.provider ?? null,
        claimToken,
        claimedAt: now,
        finalizedAt: null,
        errorMessage: null,
        payload: input.payload ?? null,
        metadata: input.metadata ?? null,
        updatedAt: now,
      },
      where: or(
        eq(socialDispatchRuns.state, "pending"),
        eq(socialDispatchRuns.state, "failed"),
        and(
          eq(socialDispatchRuns.state, "claimed"),
          or(
            isNull(socialDispatchRuns.claimedAt),
            lt(socialDispatchRuns.claimedAt, staleClaimBefore),
          ),
        ),
      ),
    })
    .returning();

  if (inserted) {
    return inserted;
  }

  const [existing] = await db
    .select()
    .from(socialDispatchRuns)
    .where(eq(socialDispatchRuns.dispatchKey, input.dispatchKey));

  return existing ?? null;
}

export async function finalizeSocialDispatchRun(input: {
  dispatchKey: string;
  state: "succeeded" | "failed";
  errorMessage?: string | null;
  result?: Record<string, unknown> | null;
  finalizedAt?: Date;
  now?: Date;
}) {
  const db = getDb();
  const now = input.now ?? new Date();

  const [row] = await db
    .update(socialDispatchRuns)
    .set({
      state: input.state,
      errorMessage: input.errorMessage ?? null,
      result: input.result ?? null,
      finalizedAt: input.finalizedAt ?? now,
      updatedAt: now,
    })
    .where(eq(socialDispatchRuns.dispatchKey, input.dispatchKey))
    .returning();

  if (!row) {
    throw new SocialDispatchRunNotFoundError(input.dispatchKey);
  }

  return row;
}

export async function claimSocialTokenRefreshLease(input: {
  workspaceId: string;
  socialAccountId: string;
  claimedBy?: string | null;
  leaseSeconds?: number;
  now?: Date;
}) {
  const db = getDb();
  const now = input.now ?? new Date();
  const leaseSeconds = input.leaseSeconds ?? 15 * 60;
  const leaseToken = randomUUID();
  const leaseExpiresAt = new Date(now.getTime() + leaseSeconds * 1000);

  return db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(socialTokenRefreshLeases)
      .where(
        and(
          eq(socialTokenRefreshLeases.workspaceId, input.workspaceId),
          eq(socialTokenRefreshLeases.socialAccountId, input.socialAccountId),
        ),
      );

    if (
      current &&
      current.state === "active" &&
      current.leaseExpiresAt > now &&
      current.releasedAt == null
    ) {
      return null;
    }

    if (current) {
      const [row] = await tx
        .update(socialTokenRefreshLeases)
        .set({
          leaseToken,
          state: "active",
          leasedAt: now,
          leaseExpiresAt,
          releasedAt: null,
          claimedBy: input.claimedBy ?? null,
          lastError: null,
          updatedAt: now,
        })
        .where(
          and(
            eq(socialTokenRefreshLeases.workspaceId, input.workspaceId),
            eq(socialTokenRefreshLeases.socialAccountId, input.socialAccountId),
          ),
        )
        .returning();

      return row ?? null;
    }

    const [row] = await tx
      .insert(socialTokenRefreshLeases)
      .values({
        id: `stl_${randomUUID()}`,
        workspaceId: input.workspaceId,
        socialAccountId: input.socialAccountId,
        leaseToken,
        state: "active",
        leasedAt: now,
        leaseExpiresAt,
        releasedAt: null,
        claimedBy: input.claimedBy ?? null,
        lastError: null,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    return row ?? null;
  });
}

export async function releaseSocialTokenRefreshLease(input: {
  workspaceId: string;
  socialAccountId: string;
  leaseToken: string;
  now?: Date;
}) {
  const db = getDb();
  const now = input.now ?? new Date();

  const [row] = await db
    .update(socialTokenRefreshLeases)
    .set({
      state: "released",
      releasedAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(socialTokenRefreshLeases.workspaceId, input.workspaceId),
        eq(socialTokenRefreshLeases.socialAccountId, input.socialAccountId),
        eq(socialTokenRefreshLeases.leaseToken, input.leaseToken),
      ),
    )
    .returning();

  return row ?? null;
}

export async function markSocialEventReadForUser(input: {
  workspaceId: string;
  eventId: string;
  userId: string;
  readAt?: Date;
}) {
  const db = getDb();
  const readAt = input.readAt ?? new Date();

  const [row] = await db
    .insert(socialEventReads)
    .values({
      eventId: input.eventId,
      workspaceId: input.workspaceId,
      userId: input.userId,
      readAt,
      createdAt: readAt,
    })
    .onConflictDoUpdate({
      target: [socialEventReads.eventId, socialEventReads.userId],
      set: {
        workspaceId: input.workspaceId,
        readAt,
      },
    })
    .returning();

  return row;
}

export async function unmarkSocialEventReadForUser(input: {
  workspaceId: string;
  eventId: string;
  userId: string;
}) {
  const db = getDb();
  const [row] = await db
    .delete(socialEventReads)
    .where(
      and(
        eq(socialEventReads.workspaceId, input.workspaceId),
        eq(socialEventReads.eventId, input.eventId),
        eq(socialEventReads.userId, input.userId),
      ),
    )
    .returning();

  return row ?? null;
}

export async function getSocialEventReadForUser(input: {
  workspaceId: string;
  eventId: string;
  userId: string;
}) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(socialEventReads)
    .where(
      and(
        eq(socialEventReads.workspaceId, input.workspaceId),
        eq(socialEventReads.eventId, input.eventId),
        eq(socialEventReads.userId, input.userId),
      ),
    );

  if (!row) {
    throw new SocialEventReadNotFoundError(input.eventId);
  }

  return row;
}

export async function listSocialEventReadsForUser(
  workspaceId: string,
  userId: string,
) {
  const db = getDb();
  return db
    .select()
    .from(socialEventReads)
    .where(
      and(
        eq(socialEventReads.workspaceId, workspaceId),
        eq(socialEventReads.userId, userId),
      ),
    )
    .orderBy(desc(socialEventReads.readAt));
}

export async function upsertSocialNotificationPreferences(input: {
  workspaceId: string;
  userId: string;
  inAppEnabled?: boolean;
  emailEnabled?: boolean;
  webhookEnabled?: boolean;
  muteAll?: boolean;
  preferences?: Record<string, unknown> | null;
}) {
  const db = getDb();
  const now = new Date();

  const [row] = await db
    .insert(socialNotificationPreferences)
    .values({
      workspaceId: input.workspaceId,
      userId: input.userId,
      inAppEnabled: input.inAppEnabled ?? true,
      emailEnabled: input.emailEnabled ?? false,
      webhookEnabled: input.webhookEnabled ?? false,
      muteAll: input.muteAll ?? false,
      preferences: input.preferences ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [
        socialNotificationPreferences.workspaceId,
        socialNotificationPreferences.userId,
      ],
      set: {
        inAppEnabled: input.inAppEnabled ?? true,
        emailEnabled: input.emailEnabled ?? false,
        webhookEnabled: input.webhookEnabled ?? false,
        muteAll: input.muteAll ?? false,
        preferences: input.preferences ?? null,
        updatedAt: now,
      },
    })
    .returning();

  return row;
}

export async function getSocialNotificationPreferences(
  workspaceId: string,
  userId: string,
) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(socialNotificationPreferences)
    .where(
      and(
        eq(socialNotificationPreferences.workspaceId, workspaceId),
        eq(socialNotificationPreferences.userId, userId),
      ),
    );

  if (!row) {
    throw new SocialNotificationPreferencesNotFoundError(userId);
  }

  return row;
}

export async function deleteSocialNotificationPreferences(
  workspaceId: string,
  userId: string,
) {
  const db = getDb();
  const [row] = await db
    .delete(socialNotificationPreferences)
    .where(
      and(
        eq(socialNotificationPreferences.workspaceId, workspaceId),
        eq(socialNotificationPreferences.userId, userId),
      ),
    )
    .returning();

  if (!row) {
    throw new SocialNotificationPreferencesNotFoundError(userId);
  }

  return row;
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

export async function updateSocialWebhook(
  workspaceId: string,
  webhookId: string,
  data: {
    targetUrl?: string;
    enabled?: boolean;
  },
) {
  const db = getDb();
  const [row] = await db
    .update(socialWebhooks)
    .set({
      ...(data.targetUrl !== undefined && { targetUrl: data.targetUrl }),
      ...(data.enabled !== undefined && { enabled: data.enabled }),
      updatedAt: new Date(),
    })
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

export async function createSocialWebhookSubscription(input: {
  workspaceId: string;
  webhookId: string;
  name?: string;
  enabled?: boolean;
  filters?: Record<string, unknown> | null;
  createdByUserId: string;
}) {
  const db = getDb();
  const id = `swhsub_${randomUUID()}`;
  const now = new Date();

  const [row] = await db
    .insert(socialWebhookSubscriptions)
    .values({
      id,
      workspaceId: input.workspaceId,
      webhookId: input.webhookId,
      name: input.name ?? null,
      enabled: input.enabled ?? true,
      filters: input.filters ?? null,
      createdByUserId: input.createdByUserId,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  return row;
}

export async function listSocialWebhookSubscriptions(
  workspaceId: string,
  filters?: {
    webhookId?: string;
    enabled?: boolean;
  },
) {
  const db = getDb();
  const conditions = [eq(socialWebhookSubscriptions.workspaceId, workspaceId)];

  if (filters?.webhookId) {
    conditions.push(eq(socialWebhookSubscriptions.webhookId, filters.webhookId));
  }
  if (filters?.enabled !== undefined) {
    conditions.push(eq(socialWebhookSubscriptions.enabled, filters.enabled));
  }

  return db
    .select()
    .from(socialWebhookSubscriptions)
    .where(and(...conditions))
    .orderBy(desc(socialWebhookSubscriptions.createdAt));
}

export async function getSocialWebhookSubscription(
  workspaceId: string,
  subscriptionId: string,
) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(socialWebhookSubscriptions)
    .where(
      and(
        eq(socialWebhookSubscriptions.workspaceId, workspaceId),
        eq(socialWebhookSubscriptions.id, subscriptionId),
      ),
    );

  if (!row) {
    throw new SocialWebhookSubscriptionNotFoundError(subscriptionId);
  }

  return row;
}

export async function updateSocialWebhookSubscription(
  workspaceId: string,
  subscriptionId: string,
  data: {
    name?: string | null;
    enabled?: boolean;
    filters?: Record<string, unknown> | null;
  },
) {
  const db = getDb();
  const [row] = await db
    .update(socialWebhookSubscriptions)
    .set({
      ...(data.name !== undefined && { name: data.name }),
      ...(data.enabled !== undefined && { enabled: data.enabled }),
      ...(data.filters !== undefined && { filters: data.filters }),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(socialWebhookSubscriptions.workspaceId, workspaceId),
        eq(socialWebhookSubscriptions.id, subscriptionId),
      ),
    )
    .returning();

  if (!row) {
    throw new SocialWebhookSubscriptionNotFoundError(subscriptionId);
  }

  return row;
}

export async function deleteSocialWebhookSubscription(
  workspaceId: string,
  subscriptionId: string,
) {
  const db = getDb();
  const [row] = await db
    .delete(socialWebhookSubscriptions)
    .where(
      and(
        eq(socialWebhookSubscriptions.workspaceId, workspaceId),
        eq(socialWebhookSubscriptions.id, subscriptionId),
      ),
    )
    .returning();

  if (!row) {
    throw new SocialWebhookSubscriptionNotFoundError(subscriptionId);
  }

  return row;
}

export async function listMatchingSocialWebhookSubscriptions(
  input: SocialWebhookMatchInput,
) {
  const db = getDb();
  const rows = await db
    .select({
      subscriptionId: socialWebhookSubscriptions.id,
      workspaceId: socialWebhookSubscriptions.workspaceId,
      webhookId: socialWebhookSubscriptions.webhookId,
      name: socialWebhookSubscriptions.name,
      enabled: socialWebhookSubscriptions.enabled,
      filters: socialWebhookSubscriptions.filters,
      createdByUserId: socialWebhookSubscriptions.createdByUserId,
      createdAt: socialWebhookSubscriptions.createdAt,
      updatedAt: socialWebhookSubscriptions.updatedAt,
      targetUrl: socialWebhooks.targetUrl,
      signingSecretEncrypted: socialWebhooks.signingSecretEncrypted,
      webhookEnabled: socialWebhooks.enabled,
    })
    .from(socialWebhookSubscriptions)
    .innerJoin(socialWebhooks, eq(socialWebhookSubscriptions.webhookId, socialWebhooks.id))
    .where(
      and(
        eq(socialWebhookSubscriptions.workspaceId, input.workspaceId),
        eq(socialWebhookSubscriptions.enabled, true),
        eq(socialWebhooks.enabled, true),
        ...(input.webhookId
          ? [eq(socialWebhookSubscriptions.webhookId, input.webhookId)]
          : []),
      ),
    )
    .orderBy(desc(socialWebhookSubscriptions.createdAt));

  return rows.filter((row) =>
    matchesWebhookSubscriptionFilter(row.filters, input),
  );
}

export async function createSocialWebhookDeliveryDeadLetter(input: {
  workspaceId: string;
  deliveryId: string;
  webhookId: string;
  eventId: string;
  deadLetterReason: string;
  responseStatus?: number | null;
  responseBody?: string | null;
  replayMetadata?: Record<string, unknown> | null;
  replayRequestedByUserId?: string | null;
  replayState?: SocialWebhookDeadLetterReplayState;
  replayRequestedAt?: Date | null;
  replayedAt?: Date | null;
  replayDeliveryId?: string | null;
  replayError?: string | null;
}) {
  const db = getDb();
  const now = new Date();
  const id = `swhdl_${randomUUID()}`;

  const [row] = await db
    .insert(socialWebhookDeliveryDeadLetters)
    .values({
      id,
      workspaceId: input.workspaceId,
      deliveryId: input.deliveryId,
      webhookId: input.webhookId,
      eventId: input.eventId,
      deadLetterReason: input.deadLetterReason,
      responseStatus: input.responseStatus ?? null,
      responseBody: input.responseBody ?? null,
      replayState: input.replayState ?? "dead_lettered",
      deadLetteredAt: now,
      replayRequestedAt: input.replayRequestedAt ?? null,
      replayRequestedByUserId: input.replayRequestedByUserId ?? null,
      replayMetadata: input.replayMetadata ?? null,
      replayDeliveryId: input.replayDeliveryId ?? null,
      replayedAt: input.replayedAt ?? null,
      replayError: input.replayError ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: socialWebhookDeliveryDeadLetters.deliveryId,
      set: {
        workspaceId: input.workspaceId,
        webhookId: input.webhookId,
        eventId: input.eventId,
        deadLetterReason: input.deadLetterReason,
        responseStatus: input.responseStatus ?? null,
        responseBody: input.responseBody ?? null,
        replayState: input.replayState ?? "dead_lettered",
        deadLetteredAt: now,
        replayRequestedAt: input.replayRequestedAt ?? null,
        replayRequestedByUserId: input.replayRequestedByUserId ?? null,
        replayMetadata: input.replayMetadata ?? null,
        replayDeliveryId: input.replayDeliveryId ?? null,
        replayedAt: input.replayedAt ?? null,
        replayError: input.replayError ?? null,
        updatedAt: now,
      },
    })
    .returning();

  return row;
}

export async function listSocialWebhookDeliveryDeadLetters(
  workspaceId: string,
  filters?: {
    webhookId?: string;
    replayState?: SocialWebhookDeadLetterReplayState;
    limit?: number;
    offset?: number;
  },
) {
  const db = getDb();
  const conditions = [eq(socialWebhookDeliveryDeadLetters.workspaceId, workspaceId)];

  if (filters?.webhookId) {
    conditions.push(eq(socialWebhookDeliveryDeadLetters.webhookId, filters.webhookId));
  }
  if (filters?.replayState) {
    conditions.push(eq(socialWebhookDeliveryDeadLetters.replayState, filters.replayState));
  }

  const query = db
    .select({
      deadLetterId: socialWebhookDeliveryDeadLetters.id,
      workspaceId: socialWebhookDeliveryDeadLetters.workspaceId,
      deliveryId: socialWebhookDeliveryDeadLetters.deliveryId,
      webhookId: socialWebhookDeliveryDeadLetters.webhookId,
      eventId: socialWebhookDeliveryDeadLetters.eventId,
      deadLetterReason: socialWebhookDeliveryDeadLetters.deadLetterReason,
      responseStatus: socialWebhookDeliveryDeadLetters.responseStatus,
      responseBody: socialWebhookDeliveryDeadLetters.responseBody,
      replayState: socialWebhookDeliveryDeadLetters.replayState,
      deadLetteredAt: socialWebhookDeliveryDeadLetters.deadLetteredAt,
      replayRequestedAt: socialWebhookDeliveryDeadLetters.replayRequestedAt,
      replayRequestedByUserId: socialWebhookDeliveryDeadLetters.replayRequestedByUserId,
      replayMetadata: socialWebhookDeliveryDeadLetters.replayMetadata,
      replayDeliveryId: socialWebhookDeliveryDeadLetters.replayDeliveryId,
      replayedAt: socialWebhookDeliveryDeadLetters.replayedAt,
      replayError: socialWebhookDeliveryDeadLetters.replayError,
      createdAt: socialWebhookDeliveryDeadLetters.createdAt,
      updatedAt: socialWebhookDeliveryDeadLetters.updatedAt,
      targetUrl: socialWebhooks.targetUrl,
      deliveryStatus: socialWebhookDeliveries.status,
      attemptCount: socialWebhookDeliveries.attemptCount,
      eventType: socialEvents.eventType,
      eventMessage: socialEvents.message,
    })
    .from(socialWebhookDeliveryDeadLetters)
    .innerJoin(
      socialWebhookDeliveries,
      eq(socialWebhookDeliveryDeadLetters.deliveryId, socialWebhookDeliveries.id),
    )
    .innerJoin(socialWebhooks, eq(socialWebhookDeliveryDeadLetters.webhookId, socialWebhooks.id))
    .innerJoin(socialEvents, eq(socialWebhookDeliveryDeadLetters.eventId, socialEvents.id))
    .where(and(...conditions))
    .orderBy(desc(socialWebhookDeliveryDeadLetters.deadLetteredAt));

  if (filters?.limit) {
    query.limit(filters.limit);
  }
  if (filters?.offset) {
    query.offset(filters.offset);
  }

  return query;
}

export async function markSocialWebhookDeliveryDeadLetterReplayRequested(input: {
  deadLetterId: string;
  replayRequestedByUserId?: string | null;
  replayMetadata?: Record<string, unknown> | null;
  replayRequestedAt?: Date;
}) {
  const db = getDb();
  const now = input.replayRequestedAt ?? new Date();
  const [row] = await db
    .update(socialWebhookDeliveryDeadLetters)
    .set({
      replayState: "replay_requested",
      replayRequestedAt: now,
      replayRequestedByUserId: input.replayRequestedByUserId ?? null,
      replayMetadata: input.replayMetadata ?? null,
      updatedAt: now,
    })
    .where(eq(socialWebhookDeliveryDeadLetters.id, input.deadLetterId))
    .returning();

  if (!row) {
    throw new SocialWebhookDeliveryDeadLetterNotFoundError(input.deadLetterId);
  }

  return row;
}

export async function markSocialWebhookDeliveryDeadLetterReplayed(input: {
  deadLetterId: string;
  replayDeliveryId?: string | null;
  replayMetadata?: Record<string, unknown> | null;
  replayedAt?: Date;
}) {
  const db = getDb();
  const now = input.replayedAt ?? new Date();
  const [row] = await db
    .update(socialWebhookDeliveryDeadLetters)
    .set({
      replayState: "replayed",
      replayDeliveryId: input.replayDeliveryId ?? null,
      replayMetadata: input.replayMetadata ?? null,
      replayedAt: now,
      updatedAt: now,
    })
    .where(eq(socialWebhookDeliveryDeadLetters.id, input.deadLetterId))
    .returning();

  if (!row) {
    throw new SocialWebhookDeliveryDeadLetterNotFoundError(input.deadLetterId);
  }

  return row;
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

    const subscriptionRows = await tx
      .select({
        webhookId: socialWebhookSubscriptions.webhookId,
        filters: socialWebhookSubscriptions.filters,
      })
      .from(socialWebhookSubscriptions)
      .innerJoin(
        socialWebhooks,
        eq(socialWebhookSubscriptions.webhookId, socialWebhooks.id),
      )
      .where(
        and(
          eq(socialWebhookSubscriptions.workspaceId, input.workspaceId),
          eq(socialWebhookSubscriptions.enabled, true),
          eq(socialWebhooks.enabled, true),
        ),
      );

    const matchedSubscriptionWebhooks = new Set(
      subscriptionRows
        .filter((row) =>
          matchesWebhookSubscriptionFilter(row.filters, {
            workspaceId: input.workspaceId,
            eventType: input.eventType,
            severity: input.severity,
            platform: input.provider,
            userFacing: input.userFacing ?? false,
            postId: input.postId,
            accountId: input.accountId,
            dispatchKey: input.dispatchKey,
            metadata: input.metadata,
          }),
        )
        .map((row) => row.webhookId),
    );

    const activeWebhooks =
      matchedSubscriptionWebhooks.size > 0
        ? Array.from(matchedSubscriptionWebhooks).map((id) => ({ id }))
        : await tx
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

export async function markSocialEventUnread(
  workspaceId: string,
  eventId: string,
) {
  const db = getDb();
  const [row] = await db
    .update(socialEvents)
    .set({
      readAt: null,
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

export async function socialEventBelongsToWorkspace(
  workspaceId: string,
  eventId: string,
) {
  const db = getDb();
  const [row] = await db
    .select({ id: socialEvents.id })
    .from(socialEvents)
    .where(
      and(eq(socialEvents.workspaceId, workspaceId), eq(socialEvents.id, eventId)),
    )
    .limit(1);

  return Boolean(row);
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

// ---------------------------------------------------------------------------
// Automation rules + tasks
// ---------------------------------------------------------------------------

export function buildAutomationTaskKey(input: {
  workspaceId: string;
  ruleId: string;
  runIndex: number;
}) {
  return `${input.workspaceId}:${input.ruleId}:${input.runIndex}`;
}

export async function createAutomationRule(input: {
  workspaceId: string;
  name: string;
  triggerSource: string;
  triggerFilters?: Record<string, unknown> | null;
  repeatIntervalSeconds?: number | null;
  maxRuns?: number | null;
  actionType?: string;
  actionConfig?: Record<string, unknown> | null;
  enabled?: boolean;
  createdByUserId: string;
}) {
  const db = getDb();
  const id = `arule_${randomUUID()}`;
  const now = new Date();

  const [row] = await db
    .insert(socialAutomationRules)
    .values({
      id,
      workspaceId: input.workspaceId,
      name: input.name,
      enabled: input.enabled ?? true,
      triggerSource: input.triggerSource,
      triggerFilters: input.triggerFilters ?? null,
      repeatIntervalSeconds: input.repeatIntervalSeconds ?? null,
      maxRuns: input.maxRuns ?? null,
      totalRuns: 0,
      actionType: input.actionType ?? "create_social_post",
      actionConfig: input.actionConfig ?? null,
      createdByUserId: input.createdByUserId,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  return row;
}

export async function listAutomationRules(
  workspaceId: string,
  filters?: {
    enabled?: boolean;
    triggerSource?: string;
    limit?: number;
    offset?: number;
  },
) {
  const db = getDb();
  const conditions = [eq(socialAutomationRules.workspaceId, workspaceId)];

  if (filters?.enabled !== undefined) {
    conditions.push(eq(socialAutomationRules.enabled, filters.enabled));
  }
  if (filters?.triggerSource) {
    conditions.push(eq(socialAutomationRules.triggerSource, filters.triggerSource));
  }

  const query = db
    .select()
    .from(socialAutomationRules)
    .where(and(...conditions))
    .orderBy(desc(socialAutomationRules.createdAt));

  if (filters?.limit) {
    query.limit(filters.limit);
  }
  if (filters?.offset) {
    query.offset(filters.offset);
  }

  return query;
}

export async function getAutomationRule(workspaceId: string, ruleId: string) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(socialAutomationRules)
    .where(
      and(
        eq(socialAutomationRules.workspaceId, workspaceId),
        eq(socialAutomationRules.id, ruleId),
      ),
    );

  if (!row) {
    throw new AutomationRuleNotFoundError(ruleId);
  }

  return row;
}

export async function updateAutomationRule(
  workspaceId: string,
  ruleId: string,
  data: {
    name?: string;
    triggerSource?: string;
    triggerFilters?: Record<string, unknown> | null;
    repeatIntervalSeconds?: number | null;
    maxRuns?: number | null;
    totalRuns?: number;
    actionType?: string;
    actionConfig?: Record<string, unknown> | null;
    enabled?: boolean;
  },
) {
  const db = getDb();
  const [row] = await db
    .update(socialAutomationRules)
    .set({
      ...(data.name !== undefined && { name: data.name }),
      ...(data.triggerSource !== undefined && {
        triggerSource: data.triggerSource,
      }),
      ...(data.triggerFilters !== undefined && {
        triggerFilters: data.triggerFilters,
      }),
      ...(data.repeatIntervalSeconds !== undefined && {
        repeatIntervalSeconds: data.repeatIntervalSeconds,
      }),
      ...(data.maxRuns !== undefined && {
        maxRuns: data.maxRuns,
      }),
      ...(data.totalRuns !== undefined && {
        totalRuns: data.totalRuns,
      }),
      ...(data.actionType !== undefined && { actionType: data.actionType }),
      ...(data.actionConfig !== undefined && {
        actionConfig: data.actionConfig,
      }),
      ...(data.enabled !== undefined && { enabled: data.enabled }),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(socialAutomationRules.workspaceId, workspaceId),
        eq(socialAutomationRules.id, ruleId),
      ),
    )
    .returning();

  if (!row) {
    throw new AutomationRuleNotFoundError(ruleId);
  }

  return row;
}

export async function deleteAutomationRule(
  workspaceId: string,
  ruleId: string,
) {
  const db = getDb();
  const [row] = await db
    .delete(socialAutomationRules)
    .where(
      and(
        eq(socialAutomationRules.workspaceId, workspaceId),
        eq(socialAutomationRules.id, ruleId),
      ),
    )
    .returning();

  if (!row) {
    throw new AutomationRuleNotFoundError(ruleId);
  }

  return row;
}

export async function createAutomationTask(input: {
  workspaceId: string;
  ruleId: string;
  taskKey: string;
  runIndex: number;
  dueAt?: Date | null;
  input?: Record<string, unknown> | null;
  result?: Record<string, unknown> | null;
  errorMessage?: string | null;
  sourcePostId?: string | null;
  sourceEventId?: string | null;
  state?: AutomationTaskState;
  claimedBy?: string | null;
  claimedAt?: Date | null;
  claimToken?: string | null;
}) {
  const db = getDb();
  const id = `atask_${randomUUID()}`;
  const now = new Date();

  const [row] = await db
    .insert(socialAutomationTasks)
    .values({
      id,
      workspaceId: input.workspaceId,
      ruleId: input.ruleId,
      taskKey: input.taskKey,
      runIndex: input.runIndex,
      state: input.state ?? "pending",
      dueAt: input.dueAt ?? null,
      claimToken: input.claimToken ?? null,
      claimedAt: input.claimedAt ?? null,
      claimedBy: input.claimedBy ?? null,
      attemptCount: 0,
      input: input.input ?? null,
      result: input.result ?? null,
      errorMessage: input.errorMessage ?? null,
      sourcePostId: input.sourcePostId ?? null,
      sourceEventId: input.sourceEventId ?? null,
      completedAt: null,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing({
      target: [socialAutomationTasks.taskKey],
    })
    .returning();

  if (row) {
    return row;
  }

  const [existing] = await db
    .select()
    .from(socialAutomationTasks)
    .where(eq(socialAutomationTasks.taskKey, input.taskKey))
    .limit(1);

  if (!existing) {
    throw new Error(
      `Failed to create automation task with key "${input.taskKey}".`,
    );
  }

  return existing;
}

export async function listAutomationTasks(
  workspaceId: string,
  filters?: {
    ruleId?: string;
    state?: AutomationTaskState;
    limit?: number;
    offset?: number;
  },
) {
  const db = getDb();
  const conditions = [eq(socialAutomationTasks.workspaceId, workspaceId)];

  if (filters?.ruleId) {
    conditions.push(eq(socialAutomationTasks.ruleId, filters.ruleId));
  }
  if (filters?.state) {
    conditions.push(eq(socialAutomationTasks.state, filters.state));
  }

  const query = db
    .select()
    .from(socialAutomationTasks)
    .where(and(...conditions))
    .orderBy(desc(socialAutomationTasks.createdAt));

  if (filters?.limit) {
    query.limit(filters.limit);
  }
  if (filters?.offset) {
    query.offset(filters.offset);
  }

  return query;
}

export async function getAutomationTask(workspaceId: string, taskId: string) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(socialAutomationTasks)
    .where(
      and(
        eq(socialAutomationTasks.workspaceId, workspaceId),
        eq(socialAutomationTasks.id, taskId),
      ),
    );

  if (!row) {
    throw new AutomationTaskNotFoundError(taskId);
  }

  return row;
}

export async function updateAutomationTask(
  workspaceId: string,
  taskId: string,
  data: {
    state?: AutomationTaskState;
    dueAt?: Date | null;
    claimToken?: string | null;
    claimedAt?: Date | null;
    claimedBy?: string | null;
    attemptCount?: number;
    input?: Record<string, unknown> | null;
    result?: Record<string, unknown> | null;
    errorMessage?: string | null;
    sourcePostId?: string | null;
    sourceEventId?: string | null;
    completedAt?: Date | null;
  },
) {
  const db = getDb();
  const [row] = await db
    .update(socialAutomationTasks)
    .set({
      ...(data.state !== undefined && { state: data.state }),
      ...(data.dueAt !== undefined && { dueAt: data.dueAt }),
      ...(data.claimToken !== undefined && { claimToken: data.claimToken }),
      ...(data.claimedAt !== undefined && { claimedAt: data.claimedAt }),
      ...(data.claimedBy !== undefined && { claimedBy: data.claimedBy }),
      ...(data.attemptCount !== undefined && { attemptCount: data.attemptCount }),
      ...(data.input !== undefined && { input: data.input }),
      ...(data.result !== undefined && { result: data.result }),
      ...(data.errorMessage !== undefined && { errorMessage: data.errorMessage }),
      ...(data.sourcePostId !== undefined && { sourcePostId: data.sourcePostId }),
      ...(data.sourceEventId !== undefined && { sourceEventId: data.sourceEventId }),
      ...(data.completedAt !== undefined && { completedAt: data.completedAt }),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(socialAutomationTasks.workspaceId, workspaceId),
        eq(socialAutomationTasks.id, taskId),
      ),
    )
    .returning();

  if (!row) {
    throw new AutomationTaskNotFoundError(taskId);
  }

  return row;
}

export async function deleteAutomationTask(
  workspaceId: string,
  taskId: string,
) {
  const db = getDb();
  const [row] = await db
    .delete(socialAutomationTasks)
    .where(
      and(
        eq(socialAutomationTasks.workspaceId, workspaceId),
        eq(socialAutomationTasks.id, taskId),
      ),
    )
    .returning();

  if (!row) {
    throw new AutomationTaskNotFoundError(taskId);
  }

  return row;
}

export async function claimDueAutomationTasks(input?: {
  workspaceId?: string;
  ruleId?: string;
  now?: Date;
  lockStaleBefore?: Date;
  limit?: number;
}) {
  const db = getDb();
  const now = input?.now ?? new Date();
  const lockStaleBefore =
    input?.lockStaleBefore ?? new Date(now.getTime() - 10 * 60 * 1000);
  const limit = input?.limit ?? 25;

  const conditions = [
    eq(socialAutomationTasks.state, "pending"),
    or(isNull(socialAutomationTasks.dueAt), lte(socialAutomationTasks.dueAt, now)),
    or(
      isNull(socialAutomationTasks.claimedAt),
      lt(socialAutomationTasks.claimedAt, lockStaleBefore),
    ),
  ];

  if (input?.workspaceId) {
    conditions.push(eq(socialAutomationTasks.workspaceId, input.workspaceId));
  }
  if (input?.ruleId) {
    conditions.push(eq(socialAutomationTasks.ruleId, input.ruleId));
  }

  const candidates = await db
    .select()
    .from(socialAutomationTasks)
    .where(and(...conditions))
    .orderBy(asc(socialAutomationTasks.dueAt), asc(socialAutomationTasks.createdAt))
    .limit(limit);

  const claimToken = randomUUID();
  const claimedRows: Array<(typeof candidates)[number]> = [];

  for (const task of candidates) {
    const updated = await db
      .update(socialAutomationTasks)
      .set({
        state: "claimed",
        claimToken,
        claimedAt: now,
        attemptCount: sql`${socialAutomationTasks.attemptCount} + 1`,
        updatedAt: now,
      })
      .where(
        and(
          eq(socialAutomationTasks.id, task.id),
          eq(socialAutomationTasks.state, "pending"),
          or(
            isNull(socialAutomationTasks.claimedAt),
            lt(socialAutomationTasks.claimedAt, lockStaleBefore),
          ),
        ),
      )
      .returning();

    const row = updated[0];
    if (row) {
      claimedRows.push(row);
    }
  }

  return claimedRows;
}

export async function getNextAutomationRunIndex(
  workspaceId: string,
  ruleId: string,
) {
  const db = getDb();
  const [row] = await db
    .select({
      maxRunIndex: sql<number>`cast(coalesce(max(${socialAutomationTasks.runIndex}), 0) as int)`,
    })
    .from(socialAutomationTasks)
    .where(
      and(
        eq(socialAutomationTasks.workspaceId, workspaceId),
        eq(socialAutomationTasks.ruleId, ruleId),
      ),
    );

  return (row?.maxRunIndex ?? 0) + 1;
}

export async function incrementAutomationRuleRunCount(input: {
  workspaceId: string;
  ruleId: string;
}) {
  const db = getDb();
  const [row] = await db
    .update(socialAutomationRules)
    .set({
      totalRuns: sql`${socialAutomationRules.totalRuns} + 1`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(socialAutomationRules.workspaceId, input.workspaceId),
        eq(socialAutomationRules.id, input.ruleId),
      ),
    )
    .returning();

  if (!row) {
    throw new AutomationRuleNotFoundError(input.ruleId);
  }

  return row;
}
