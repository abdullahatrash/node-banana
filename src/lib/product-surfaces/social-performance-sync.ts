import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { and, asc, eq, isNull, lte } from "drizzle-orm";
import { z } from "zod";
import { canonicalDigest } from "@/lib/agent-tools/canonical";
import { getDb } from "@/lib/db";
import { assets, socialAccounts, socialPosts, workspaceContentPerformanceSyncJobs, workspaceContentPerformanceSyncs } from "@/lib/db/schema";
import { inspirationRightsSnapshots } from "@/lib/model-routing/db-schema";
import { hydrateRightsSnapshot, validateRightsEvidence } from "@/lib/model-routing/rights-evidence";
import type { InspirationRightsSnapshot } from "@/lib/model-routing/types";
import { decryptToken, encryptToken } from "@/lib/social/crypto";
import type { PostMetricsResult, SocialProviderAdapter } from "@/lib/social/provider-interface";
import { getProvider } from "@/lib/social/provider-registry";
import { markRequiresReauth, updateSocialAccountTokens } from "@/lib/social/repository";
import { ensureSocialProvidersBootstrapped } from "@/lib/social/runtime-bootstrap";
import { ARABIC_VARIETIES, CONTENT_FORMATS } from "./definitions";
import { recordPlatformVerifiedPerformanceObservation, WorkspacePerformanceObservationError } from "./workspace-performance-observations";
import { requestWorkspaceTrendRefresh } from "./trend-ingestion-repository";

const identifier = z.string().trim().min(1).max(200);
const digest = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const supportedPlatforms = new Set(["instagram", "tiktok", "youtube"]);

const classificationShape = {
  region: z.string().trim().min(1).max(80),
  contentLanguage: z.enum(["ar", "en"]),
  arabicVariety: z.enum(ARABIC_VARIETIES).nullable(),
  format: z.enum(CONTENT_FORMATS),
  tags: z.array(z.string().trim().min(1).max(80)).max(30),
} as const;

const enablePerformanceSyncSchema = z.object({
  action: z.literal("enable"), postId: identifier, sourceAssetId: identifier,
  rightsSnapshot: z.object({ id: identifier, revision: z.number().int().positive(), digest }).strict(),
  scheduleMinutes: z.number().int().min(15).max(10_080).default(60),
  ...classificationShape,
}).strict();

export const performanceSyncCommandSchema = z.discriminatedUnion("action", [
  enablePerformanceSyncSchema,
  z.object({ action: z.literal("pause"), syncId: identifier }).strict(),
  z.object({ action: z.literal("resume"), syncId: identifier }).strict(),
  z.object({ action: z.literal("run_now"), syncId: identifier }).strict(),
]);

export class SocialPerformanceSyncError extends Error {
  constructor(readonly code: string) { super(code); }
}

export async function listPerformanceSyncs(workspaceId: string) {
  return getDb().select({
    id: workspaceContentPerformanceSyncs.id, postId: workspaceContentPerformanceSyncs.postId, sourceAssetId: workspaceContentPerformanceSyncs.sourceAssetId,
    state: workspaceContentPerformanceSyncs.state, scheduleMinutes: workspaceContentPerformanceSyncs.scheduleMinutes, nextRunAt: workspaceContentPerformanceSyncs.nextRunAt,
    lastObservedAt: workspaceContentPerformanceSyncs.lastObservedAt, lastErrorCode: workspaceContentPerformanceSyncs.lastErrorCode,
  }).from(workspaceContentPerformanceSyncs).where(eq(workspaceContentPerformanceSyncs.workspaceId, workspaceId)).orderBy(asc(workspaceContentPerformanceSyncs.createdAt), asc(workspaceContentPerformanceSyncs.id));
}

function stableSyncId(workspaceId: string, postId: string, sourceAssetId: string) {
  return `wps_${createHash("sha256").update(`${workspaceId}:${postId}:${sourceAssetId}`).digest("hex").slice(0, 32)}`;
}

function cleanTags(tags: string[]) {
  return [...new Set(tags.map((tag) => tag.normalize("NFKC").trim()).filter(Boolean))].slice(0, 30);
}

export async function configurePerformanceSync(input: z.infer<typeof performanceSyncCommandSchema> & { workspaceId: string; userId: string; at?: Date }) {
  const at = input.at ?? new Date();
  if (input.action !== "enable") {
    const state = input.action === "pause" ? "paused" : "active";
    const [row] = await getDb().update(workspaceContentPerformanceSyncs).set({ state, nextRunAt: input.action === "run_now" ? at : undefined, lastErrorCode: null, updatedAt: at }).where(and(eq(workspaceContentPerformanceSyncs.workspaceId, input.workspaceId), eq(workspaceContentPerformanceSyncs.id, input.syncId))).returning();
    if (!row) throw new SocialPerformanceSyncError("PERFORMANCE_SYNC_NOT_FOUND");
    return row;
  }

  if (input.contentLanguage !== "ar" && input.arabicVariety) throw new SocialPerformanceSyncError("PERFORMANCE_SYNC_CLASSIFICATION_INVALID");

  return getDb().transaction(async (tx) => {
    const [[post], [asset], [account], [storedRights]] = await Promise.all([
      tx.select().from(socialPosts).where(and(eq(socialPosts.workspaceId, input.workspaceId), eq(socialPosts.id, input.postId))).limit(1),
      tx.select({ id: assets.id, type: assets.type, checksum: assets.checksum, metadata: assets.metadata }).from(assets).where(and(eq(assets.workspaceId, input.workspaceId), eq(assets.id, input.sourceAssetId), isNull(assets.deletedAt))).limit(1),
      tx.select({ id: socialAccounts.id, platform: socialAccounts.platform, disabled: socialAccounts.disabled, requiresReauth: socialAccounts.requiresReauth }).from(socialAccounts).innerJoin(socialPosts, and(eq(socialPosts.socialAccountId, socialAccounts.id), eq(socialPosts.workspaceId, socialAccounts.workspaceId))).where(and(eq(socialPosts.workspaceId, input.workspaceId), eq(socialPosts.id, input.postId))).limit(1),
      tx.select({ snapshot: inspirationRightsSnapshots.snapshot }).from(inspirationRightsSnapshots).where(and(eq(inspirationRightsSnapshots.workspaceId, input.workspaceId), eq(inspirationRightsSnapshots.id, input.rightsSnapshot.id), eq(inspirationRightsSnapshots.revision, input.rightsSnapshot.revision), eq(inspirationRightsSnapshots.digest, input.rightsSnapshot.digest))).limit(1),
    ]);
    if (!post || post.status !== "published" || !post.platformPostId || !post.publishedAt) throw new SocialPerformanceSyncError("PERFORMANCE_POST_NOT_PUBLISHED");
    if (!account || account.disabled || account.requiresReauth || !supportedPlatforms.has(account.platform)) throw new SocialPerformanceSyncError(account?.requiresReauth ? "PERFORMANCE_SYNC_REAUTH_REQUIRED" : "PERFORMANCE_SYNC_PROVIDER_UNSUPPORTED");
    const media = post.stableMediaRefs.find((reference) => (reference.resourceKind ?? "studio_asset") === "studio_asset" && reference.assetId === input.sourceAssetId);
    if (!asset || asset.type !== "video" || !asset.checksum || asset.metadata?.uploadState !== "ready" || media?.assetDigest !== asset.checksum) throw new SocialPerformanceSyncError("PERFORMANCE_SOURCE_ASSET_INVALID");
    const rights = storedRights ? hydrateRightsSnapshot(storedRights.snapshot as InspirationRightsSnapshot) : null;
    if (!rights || rights.basis !== "owned" || rights.sourceAssetIds.length !== 1 || rights.sourceAssetIds[0] !== asset.id || !validateRightsEvidence({ workspaceId: input.workspaceId, basis: rights.basis, permittedRemix: rights.permittedRemix, sourceAssetIds: rights.sourceAssetIds, evidence: rights.evidence, at }).ok) throw new SocialPerformanceSyncError("PERFORMANCE_RIGHTS_NOT_ADMITTED");
    const values = {
      workspaceId: input.workspaceId, id: stableSyncId(input.workspaceId, post.id, asset.id), postId: post.id, sourceAssetId: asset.id, socialAccountId: account.id,
      rightsSnapshotId: rights.id, rightsSnapshotRevision: rights.revision, rightsSnapshotDigest: rights.digest,
      region: input.region, contentLanguage: input.contentLanguage, arabicVariety: input.arabicVariety, format: input.format, tags: cleanTags(input.tags),
      state: "active", scheduleMinutes: input.scheduleMinutes, nextRunAt: at, lastErrorCode: null, createdByUserId: input.userId, createdAt: at, updatedAt: at,
    };
    const [row] = await tx.insert(workspaceContentPerformanceSyncs).values(values).onConflictDoUpdate({
      target: [workspaceContentPerformanceSyncs.workspaceId, workspaceContentPerformanceSyncs.postId, workspaceContentPerformanceSyncs.sourceAssetId],
      set: { socialAccountId: values.socialAccountId, rightsSnapshotId: values.rightsSnapshotId, rightsSnapshotRevision: values.rightsSnapshotRevision, rightsSnapshotDigest: values.rightsSnapshotDigest, region: values.region, contentLanguage: values.contentLanguage, arabicVariety: values.arabicVariety, format: values.format, tags: values.tags, state: "active", scheduleMinutes: values.scheduleMinutes, nextRunAt: at, lastErrorCode: null, updatedAt: at },
    }).returning();
    return row;
  });
}

export async function scheduleDuePerformanceSyncs(input: { at?: Date; limit?: number }) {
  const at = input.at ?? new Date();
  const limit = Math.min(100, Math.max(1, input.limit ?? 25));
  return getDb().transaction(async (tx) => {
    const rows = await tx.select().from(workspaceContentPerformanceSyncs).where(and(eq(workspaceContentPerformanceSyncs.state, "active"), lte(workspaceContentPerformanceSyncs.nextRunAt, at))).orderBy(asc(workspaceContentPerformanceSyncs.nextRunAt), asc(workspaceContentPerformanceSyncs.workspaceId), asc(workspaceContentPerformanceSyncs.id)).limit(limit).for("update", { skipLocked: true });
    let scheduled = 0;
    for (const row of rows) {
      const sourceKey = `scheduled:${row.nextRunAt.toISOString()}`;
      const inserted = await tx.insert(workspaceContentPerformanceSyncJobs).values({ workspaceId: row.workspaceId, id: randomUUID(), syncId: row.id, sourceKey, state: "queued", nextAttemptAt: at, requestedAt: at, updatedAt: at }).onConflictDoNothing().returning({ id: workspaceContentPerformanceSyncJobs.id });
      scheduled += inserted.length;
      const base = row.nextRunAt > at ? row.nextRunAt : at;
      await tx.update(workspaceContentPerformanceSyncs).set({ nextRunAt: new Date(base.getTime() + row.scheduleMinutes * 60_000), updatedAt: at }).where(and(eq(workspaceContentPerformanceSyncs.workspaceId, row.workspaceId), eq(workspaceContentPerformanceSyncs.id, row.id)));
    }
    return { scanned: rows.length, scheduled };
  });
}

type ClaimedJob = { workspaceId: string; id: string; syncId: string; leaseOwner: string; leaseGeneration: number; attempt: number; maxAttempts: number };

async function recoverExpired(at: Date, limit: number) {
  return getDb().transaction(async (tx) => {
    const rows = await tx.select().from(workspaceContentPerformanceSyncJobs).where(and(eq(workspaceContentPerformanceSyncJobs.state, "claimed"), lte(workspaceContentPerformanceSyncJobs.leaseExpiresAt, at))).orderBy(asc(workspaceContentPerformanceSyncJobs.leaseExpiresAt), asc(workspaceContentPerformanceSyncJobs.id)).limit(limit).for("update", { skipLocked: true });
    for (const row of rows) {
      const terminal = row.attempt >= row.maxAttempts;
      await tx.update(workspaceContentPerformanceSyncJobs).set({ state: terminal ? "failed_known" : "queued", leaseOwner: null, leaseExpiresAt: null, failureCode: "PERFORMANCE_SYNC_LEASE_EXPIRED", nextAttemptAt: at, finishedAt: terminal ? at : null, updatedAt: at }).where(and(eq(workspaceContentPerformanceSyncJobs.workspaceId, row.workspaceId), eq(workspaceContentPerformanceSyncJobs.id, row.id), eq(workspaceContentPerformanceSyncJobs.leaseGeneration, row.leaseGeneration)));
    }
    return rows.length;
  });
}

async function claimJobs(input: { workerId: string; at: Date; limit: number }): Promise<ClaimedJob[]> {
  const leaseUntil = new Date(input.at.getTime() + 2 * 60_000);
  return getDb().transaction(async (tx) => {
    const rows = await tx.select().from(workspaceContentPerformanceSyncJobs).where(and(eq(workspaceContentPerformanceSyncJobs.state, "queued"), lte(workspaceContentPerformanceSyncJobs.nextAttemptAt, input.at))).orderBy(asc(workspaceContentPerformanceSyncJobs.nextAttemptAt), asc(workspaceContentPerformanceSyncJobs.workspaceId), asc(workspaceContentPerformanceSyncJobs.id)).limit(input.limit).for("update", { skipLocked: true });
    const claimed: ClaimedJob[] = [];
    for (const row of rows) {
      const [updated] = await tx.update(workspaceContentPerformanceSyncJobs).set({ state: "claimed", attempt: row.attempt + 1, leaseOwner: input.workerId, leaseExpiresAt: leaseUntil, leaseGeneration: row.leaseGeneration + 1, failureCode: null, updatedAt: input.at }).where(and(eq(workspaceContentPerformanceSyncJobs.workspaceId, row.workspaceId), eq(workspaceContentPerformanceSyncJobs.id, row.id), eq(workspaceContentPerformanceSyncJobs.state, "queued"), eq(workspaceContentPerformanceSyncJobs.leaseGeneration, row.leaseGeneration))).returning();
      if (updated) claimed.push({ workspaceId: updated.workspaceId, id: updated.id, syncId: updated.syncId, leaseOwner: input.workerId, leaseGeneration: updated.leaseGeneration, attempt: updated.attempt, maxAttempts: updated.maxAttempts });
    }
    return claimed;
  });
}

function ownsJob(job: ClaimedJob) {
  return and(eq(workspaceContentPerformanceSyncJobs.workspaceId, job.workspaceId), eq(workspaceContentPerformanceSyncJobs.id, job.id), eq(workspaceContentPerformanceSyncJobs.state, "claimed"), eq(workspaceContentPerformanceSyncJobs.leaseOwner, job.leaseOwner), eq(workspaceContentPerformanceSyncJobs.leaseGeneration, job.leaseGeneration));
}

async function loadContext(job: ClaimedJob) {
  const [row] = await getDb().select({ sync: workspaceContentPerformanceSyncs, post: socialPosts, account: socialAccounts }).from(workspaceContentPerformanceSyncs).innerJoin(socialPosts, and(eq(socialPosts.workspaceId, workspaceContentPerformanceSyncs.workspaceId), eq(socialPosts.id, workspaceContentPerformanceSyncs.postId))).innerJoin(socialAccounts, and(eq(socialAccounts.workspaceId, workspaceContentPerformanceSyncs.workspaceId), eq(socialAccounts.id, workspaceContentPerformanceSyncs.socialAccountId))).where(and(eq(workspaceContentPerformanceSyncs.workspaceId, job.workspaceId), eq(workspaceContentPerformanceSyncs.id, job.syncId))).limit(1);
  return row;
}

async function usableAccessToken(account: typeof socialAccounts.$inferSelect, provider: SocialProviderAdapter, at: Date) {
  if (!account.tokenExpiresAt || account.tokenExpiresAt.getTime() > at.getTime() + 60_000) return decryptToken(account.accessTokenEncrypted);
  if (!account.refreshTokenEncrypted) throw new SocialPerformanceSyncError("PERFORMANCE_SYNC_REAUTH_REQUIRED");
  const refreshed = await provider.refreshToken(decryptToken(account.refreshTokenEncrypted));
  if (!refreshed.accessToken) throw new SocialPerformanceSyncError("PERFORMANCE_SYNC_REAUTH_REQUIRED");
  await updateSocialAccountTokens(account.id, { accessTokenEncrypted: encryptToken(refreshed.accessToken), refreshTokenEncrypted: refreshed.refreshToken ? encryptToken(refreshed.refreshToken) : account.refreshTokenEncrypted, tokenExpiresAt: refreshed.expiresIn ? new Date(at.getTime() + refreshed.expiresIn * 1_000) : undefined });
  return refreshed.accessToken;
}

async function finish(job: ClaimedJob, input: { at: Date; observationId: string; sourceDigest: string }) {
  await getDb().transaction(async (tx) => {
    const [done] = await tx.update(workspaceContentPerformanceSyncJobs).set({ state: "succeeded", leaseOwner: null, leaseExpiresAt: null, failureCode: null, observationId: input.observationId, finishedAt: input.at, updatedAt: input.at }).where(ownsJob(job)).returning({ id: workspaceContentPerformanceSyncJobs.id });
    if (!done) throw new SocialPerformanceSyncError("PERFORMANCE_SYNC_LEASE_LOST");
    await tx.update(workspaceContentPerformanceSyncs).set({ lastObservedAt: input.at, lastSourceDigest: input.sourceDigest, lastErrorCode: null, updatedAt: input.at }).where(and(eq(workspaceContentPerformanceSyncs.workspaceId, job.workspaceId), eq(workspaceContentPerformanceSyncs.id, job.syncId)));
  });
}

async function fail(job: ClaimedJob, input: { at: Date; code: string; terminal: boolean; needsReauth?: boolean; accountId?: string }) {
  const terminal = input.terminal || job.attempt >= job.maxAttempts;
  await getDb().transaction(async (tx) => {
    await tx.update(workspaceContentPerformanceSyncJobs).set({ state: terminal ? "failed_known" : "queued", leaseOwner: null, leaseExpiresAt: null, failureCode: input.code.slice(0, 500), nextAttemptAt: terminal ? input.at : new Date(input.at.getTime() + Math.min(60, 2 ** job.attempt) * 60_000), finishedAt: terminal ? input.at : null, updatedAt: input.at }).where(ownsJob(job));
    await tx.update(workspaceContentPerformanceSyncs).set({ state: input.needsReauth ? "needs_reauth" : undefined, lastErrorCode: input.code.slice(0, 500), updatedAt: input.at }).where(and(eq(workspaceContentPerformanceSyncs.workspaceId, job.workspaceId), eq(workspaceContentPerformanceSyncs.id, job.syncId)));
  });
  if (input.needsReauth && input.accountId) await markRequiresReauth(input.accountId);
  return terminal ? "failed" as const : "retried" as const;
}

async function executeJob(job: ClaimedJob, at: Date) {
  const context = await loadContext(job);
  if (!context || context.sync.state !== "active" || context.post.status !== "published" || !context.post.platformPostId || context.account.disabled || context.account.requiresReauth) return fail(job, { at, code: "PERFORMANCE_SYNC_SOURCE_UNAVAILABLE", terminal: true });
  await ensureSocialProvidersBootstrapped();
  const provider = getProvider(context.account.platform);
  if (!provider.getPostMetrics || !supportedPlatforms.has(provider.identifier)) return fail(job, { at, code: "PERFORMANCE_SYNC_PROVIDER_UNSUPPORTED", terminal: true });
  try {
    const accessToken = await usableAccessToken(context.account, provider, at);
    const results = await provider.getPostMetrics({ platformUserId: context.account.platformUserId, accessToken, accessTokenSecret: context.account.accessTokenSecret ? decryptToken(context.account.accessTokenSecret) : undefined, platformPostIds: [context.post.platformPostId] });
    const result: PostMetricsResult | undefined = results.length === 1 ? results[0] : undefined;
    if (!result || result.platformPostId !== context.post.platformPostId || Object.values(result.metrics).every((metric) => metric === null)) throw new SocialPerformanceSyncError("PERFORMANCE_SYNC_PROVIDER_MISMATCH");
    const observation = await recordPlatformVerifiedPerformanceObservation({
      workspaceId: job.workspaceId, userId: context.sync.createdByUserId, postId: context.post.id, sourceAssetId: context.sync.sourceAssetId,
      rightsSnapshot: { id: context.sync.rightsSnapshotId, revision: context.sync.rightsSnapshotRevision, digest: context.sync.rightsSnapshotDigest as `sha256:${string}` },
      platform: provider.identifier as "instagram" | "tiktok" | "youtube", socialAccountId: context.account.id, providerAccountId: context.account.platformUserId, providerPostId: result.platformPostId, providerRequestId: result.providerRequestId,
      sourceRef: result.sourceRef, metrics: result.metrics, observedAt: at, region: context.sync.region, contentLanguage: context.sync.contentLanguage as "ar" | "en", arabicVariety: context.sync.arabicVariety as (typeof ARABIC_VARIETIES)[number] | null,
      format: context.sync.format as (typeof CONTENT_FORMATS)[number], tags: context.sync.tags, idempotencyKey: `platform-sync:${job.id}`,
    });
    await finish(job, { at, observationId: observation.observation.id, sourceDigest: observation.observation.sourceDigest });
    await requestWorkspaceTrendRefresh({ workspaceId: job.workspaceId, userId: context.sync.createdByUserId, idempotencyKey: `platform-sync:${job.id}`, at });
    return "succeeded" as const;
  } catch (error) {
    if (error instanceof WorkspacePerformanceObservationError || error instanceof SocialPerformanceSyncError) return fail(job, { at, code: error.code, terminal: true, needsReauth: error.code === "PERFORMANCE_SYNC_REAUTH_REQUIRED", accountId: context.account.id });
    const classified = provider.classifyError(error);
    return fail(job, { at, code: `PERFORMANCE_SYNC_${classified.type.toUpperCase().replace("-", "_")}`, terminal: classified.type !== "retry", needsReauth: classified.type === "refresh-token", accountId: context.account.id });
  }
}

export async function runPerformanceSyncWorker(input: { workerId: string; at?: Date; limit?: number }) {
  const at = input.at ?? new Date();
  const limit = Math.min(100, Math.max(1, input.limit ?? 25));
  const [scheduled, recovered] = await Promise.all([scheduleDuePerformanceSyncs({ at, limit }), recoverExpired(at, limit)]);
  const jobs = await claimJobs({ workerId: input.workerId.slice(0, 200), at, limit });
  const results = await Promise.all(jobs.map((job) => executeJob(job, at)));
  return { scheduled: scheduled.scheduled, recovered, claimed: jobs.length, succeeded: results.filter((result) => result === "succeeded").length, retried: results.filter((result) => result === "retried").length, failed: results.filter((result) => result === "failed").length };
}

export function performanceSyncReceiptDigest(result: PostMetricsResult) {
  return canonicalDigest({ schema: "platform-performance-observation/v1", providerPostId: result.platformPostId, providerRequestId: result.providerRequestId, sourceRef: result.sourceRef, metrics: result.metrics });
}
