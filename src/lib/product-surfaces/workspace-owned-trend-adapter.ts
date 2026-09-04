import "server-only";

import { and, desc, eq, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";
import { z } from "zod";
import { canonicalDigest } from "@/lib/agent-tools/canonical";
import { getDb } from "@/lib/db";
import { assets, inspirationTrendSources, socialAccounts, socialPosts, workspaceContentPerformanceObservations, workspaceContentPerformanceSyncs } from "@/lib/db/schema";
import { inspirationRightsSnapshots } from "@/lib/model-routing/db-schema";
import { hydrateRightsSnapshot, validateRightsEvidence } from "@/lib/model-routing/rights-evidence";
import type { InspirationRightsSnapshot } from "@/lib/model-routing/types";
import { trendIngestionCandidateSchema, type TrendIngestionAdapter, type TrendIngestionCandidate } from "./trend-types";

export const WORKSPACE_OWNED_TREND_SOURCE_ID = "workspace-owned-performance";
export const WORKSPACE_OWNED_TREND_ADAPTER_KEY = "workspace-owned-performance.v1";

const cursorSchema = z.object({ observedAt: z.string().datetime({ offset: true }), id: z.string().min(1).max(200) }).strict();

function encodeCursor(value: z.infer<typeof cursorSchema>) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function decodeCursor(value: string | null) {
  if (!value) return null;
  try { return cursorSchema.parse(JSON.parse(Buffer.from(value, "base64url").toString("utf8"))); }
  catch { throw new Error("WORKSPACE_TREND_CURSOR_INVALID"); }
}

export async function ensureWorkspaceOwnedTrendSource(input: { workspaceId: string; userId: string; at?: Date }) {
  const at = input.at ?? new Date();
  const values = {
    workspaceId: input.workspaceId, id: WORKSPACE_OWNED_TREND_SOURCE_ID, adapterKey: WORKSPACE_OWNED_TREND_ADAPTER_KEY,
    sourceKind: "workspace_owned_analytics", displayName: "Workspace winning content", state: "active", scheduleMinutes: 60,
    nextRunAt: at, cursor: null, preferredRegions: [], preferredArabicVarieties: [], preferredFormats: [], preferredTags: [], excludedTags: [],
    createdByUserId: input.userId, createdAt: at, updatedAt: at,
  };
  const [created] = await getDb().insert(inspirationTrendSources).values(values).onConflictDoNothing().returning();
  if (created) return created;
  const [existing] = await getDb().select().from(inspirationTrendSources).where(and(eq(inspirationTrendSources.workspaceId, input.workspaceId), eq(inspirationTrendSources.id, WORKSPACE_OWNED_TREND_SOURCE_ID))).limit(1);
  if (!existing || existing.adapterKey !== WORKSPACE_OWNED_TREND_ADAPTER_KEY || existing.sourceKind !== "workspace_owned_analytics") throw new Error("WORKSPACE_TREND_SOURCE_CONFLICT");
  return existing;
}

export interface WorkspaceOwnedPerformanceSource {
  id: string;
  postId: string;
  title: string;
  sourceUrl: string;
  publishedAt: string;
  sourceAssetId: string;
  rightsSnapshot: { id: string; revision: number; digest: `sha256:${string}` };
  channel: string;
  socialAccountId: string;
  platform: string;
  verifiedSyncSupported: boolean;
  requiresReauth: boolean;
  sync: { id: string; state: string; scheduleMinutes: number; nextRunAt: string; lastObservedAt: string | null; lastErrorCode: string | null } | null;
}

export async function listWorkspaceOwnedPerformanceSources(input: { workspaceId: string; at?: Date; limit?: number }): Promise<WorkspaceOwnedPerformanceSource[]> {
  const at = input.at ?? new Date();
  const limit = Math.max(1, Math.min(input.limit ?? 100, 200));
  const posts = await getDb().select().from(socialPosts).where(and(eq(socialPosts.workspaceId, input.workspaceId), eq(socialPosts.status, "published"))).orderBy(desc(socialPosts.publishedAt), desc(socialPosts.id)).limit(limit * 2);
  const assetIds = [...new Set(posts.flatMap((post) => post.stableMediaRefs.filter((reference) => (reference.resourceKind ?? "studio_asset") === "studio_asset").map((reference) => reference.assetId)))];
  const accountIds = [...new Set(posts.map((post) => post.socialAccountId))];
  const [assetRows, accounts, rightsRows, syncRows] = await Promise.all([
    assetIds.length ? getDb().select({ id: assets.id, type: assets.type, checksum: assets.checksum, metadata: assets.metadata }).from(assets).where(and(eq(assets.workspaceId, input.workspaceId), inArray(assets.id, assetIds), isNull(assets.deletedAt))) : [],
    accountIds.length ? getDb().select({ id: socialAccounts.id, displayName: socialAccounts.displayName, platform: socialAccounts.platform, requiresReauth: socialAccounts.requiresReauth, disabled: socialAccounts.disabled }).from(socialAccounts).where(and(eq(socialAccounts.workspaceId, input.workspaceId), inArray(socialAccounts.id, accountIds))) : [],
    getDb().select({ snapshot: inspirationRightsSnapshots.snapshot }).from(inspirationRightsSnapshots).where(and(eq(inspirationRightsSnapshots.workspaceId, input.workspaceId), eq(inspirationRightsSnapshots.basis, "owned"))).orderBy(desc(inspirationRightsSnapshots.createdAt)).limit(1_000),
    getDb().select().from(workspaceContentPerformanceSyncs).where(eq(workspaceContentPerformanceSyncs.workspaceId, input.workspaceId)),
  ]);
  const assetById = new Map(assetRows.map((asset) => [asset.id, asset]));
  const accountById = new Map(accounts.map((account) => [account.id, account]));
  const syncBySource = new Map(syncRows.map((sync) => [`${sync.postId}:${sync.sourceAssetId}`, sync]));
  const rights = rightsRows.map((row) => hydrateRightsSnapshot(row.snapshot as InspirationRightsSnapshot)).filter((snapshot) => snapshot.createdAt <= at && validateRightsEvidence({ workspaceId: input.workspaceId, basis: snapshot.basis, permittedRemix: snapshot.permittedRemix, sourceAssetIds: snapshot.sourceAssetIds, evidence: snapshot.evidence, at }).ok);
  const results: WorkspaceOwnedPerformanceSource[] = [];
  for (const post of posts) {
    if (!post.publishedAt || !post.platformPostUrl || !isHttpsUrl(post.platformPostUrl)) continue;
    const account = accountById.get(post.socialAccountId);
    if (!account) continue;
    for (const reference of post.stableMediaRefs) {
      if ((reference.resourceKind ?? "studio_asset") !== "studio_asset") continue;
      const asset = assetById.get(reference.assetId);
      const snapshot = rights.find((candidate) => candidate.sourceAssetIds.length === 1 && candidate.sourceAssetIds[0] === reference.assetId);
      if (!asset || asset.type !== "video" || !asset.checksum || asset.metadata?.uploadState !== "ready" || reference.assetDigest !== asset.checksum || !snapshot) continue;
      const sync = syncBySource.get(`${post.id}:${asset.id}`) ?? null;
      results.push({ id: `${post.id}:${asset.id}`, postId: post.id, title: (post.content?.trim() || account.displayName || post.id).slice(0, 240), sourceUrl: post.platformPostUrl, publishedAt: post.publishedAt.toISOString(), sourceAssetId: asset.id, rightsSnapshot: { id: snapshot.id, revision: snapshot.revision, digest: snapshot.digest }, channel: `${account.displayName} · ${account.platform}`.slice(0, 200), socialAccountId: account.id, platform: account.platform, verifiedSyncSupported: ["instagram", "tiktok", "youtube"].includes(account.platform) && !account.disabled, requiresReauth: account.requiresReauth, sync: sync ? { id: sync.id, state: sync.state, scheduleMinutes: sync.scheduleMinutes, nextRunAt: sync.nextRunAt.toISOString(), lastObservedAt: sync.lastObservedAt?.toISOString() ?? null, lastErrorCode: sync.lastErrorCode } : null });
      if (results.length >= limit) return results;
    }
  }
  return results;
}

type ObservationRow = typeof workspaceContentPerformanceObservations.$inferSelect;
type PostRow = typeof socialPosts.$inferSelect;
type AssetRow = Pick<typeof assets.$inferSelect, "id" | "type" | "checksum" | "metadata">;
type AccountRow = Pick<typeof socialAccounts.$inferSelect, "id" | "displayName" | "platform">;

export function workspaceOwnedCandidateFromRecords(input: {
  workspaceId: string;
  observation: ObservationRow;
  post: PostRow | undefined;
  asset: AssetRow | undefined;
  account: AccountRow | undefined;
  rights: InspirationRightsSnapshot | null;
  requestedAt: Date;
}): TrendIngestionCandidate | null {
  const { observation, post, asset, account, rights } = input;
  const media = post?.stableMediaRefs.find((reference) => (reference.resourceKind ?? "studio_asset") === "studio_asset" && reference.assetId === observation.sourceAssetId);
  const sourceUrl = post?.platformPostUrl;
  if (!post || post.status !== "published" || !post.publishedAt || !sourceUrl || !isHttpsUrl(sourceUrl) || !account) return null;
  if (!asset || asset.type !== "video" || !asset.checksum || asset.metadata?.uploadState !== "ready" || media?.assetDigest !== asset.checksum) return null;
  if (!rights || rights.basis !== "owned" || rights.sourceAssetIds.length !== 1 || rights.sourceAssetIds[0] !== asset.id || rights.createdAt > observation.observedAt) return null;
  if (!validateRightsEvidence({ workspaceId: input.workspaceId, basis: rights.basis, permittedRemix: rights.permittedRemix, sourceAssetIds: rights.sourceAssetIds, evidence: rights.evidence, at: input.requestedAt }).ok || observation.observedAt < post.publishedAt) return null;
  const expiresAt = rights.evidence.map((item) => item.expiresAt).filter((value): value is Date => Boolean(value)).sort((left, right) => left.getTime() - right.getTime())[0] ?? null;
  const permittedInfluence = rights.permittedRemix === "reference_only" ? ["topic"] as const : ["topic", "hook", "pacing", "structure"] as const;
  const title = (post.content?.trim() || account.displayName || post.id).slice(0, 240);
  const sourceName = `${account.displayName} · ${account.platform}`.slice(0, 200);
  return trendIngestionCandidateSchema.parse({
    externalItemId: post.id, title, sourceUrl, sourceName, sourcePublishedAt: post.publishedAt.toISOString(),
    sourceContentDigest: canonicalDigest({ schema: "workspace-published-content/v1", postId: post.id, content: post.content, platformPostUrl: sourceUrl, assetId: asset.id, assetDigest: asset.checksum }),
    metricsObservedAt: observation.observedAt.toISOString(), metrics: { views: observation.views, likes: observation.likes, comments: observation.comments }, region: observation.region,
    observationProvenance: { kind: observation.sourceKind as "workspace_attested" | "platform_verified", ref: observation.sourceRef, digest: observation.sourceDigest },
    contentLanguage: observation.contentLanguage, arabicVariety: observation.arabicVariety, format: observation.format, tags: observation.tags,
    rights: { status: "user_submitted", evidenceRef: `workspace-rights:${rights.id}@${rights.revision}`, evidenceDigest: rights.digest, observedAt: rights.createdAt.toISOString(), expiresAt: expiresAt?.toISOString() ?? null, sourceAssetId: asset.id, sourceMediaType: "video", rightsSnapshot: { id: rights.id, revision: rights.revision, digest: rights.digest }, permittedInfluence },
  });
}

export const workspaceOwnedTrendAdapter: TrendIngestionAdapter = {
  key: WORKSPACE_OWNED_TREND_ADAPTER_KEY,
  async fetch(input) {
    if (input.sourceId !== WORKSPACE_OWNED_TREND_SOURCE_ID) throw new Error("WORKSPACE_TREND_SOURCE_INVALID");
    const limit = Math.max(1, Math.min(input.limit, 100));
    const cursor = decodeCursor(input.cursor);
    const cursorCondition = cursor
      ? or(lt(workspaceContentPerformanceObservations.observedAt, new Date(cursor.observedAt)), and(eq(workspaceContentPerformanceObservations.observedAt, new Date(cursor.observedAt)), lt(workspaceContentPerformanceObservations.id, cursor.id)))
      : undefined;
    const rows = await getDb().select().from(workspaceContentPerformanceObservations).where(and(
      eq(workspaceContentPerformanceObservations.workspaceId, input.workspaceId),
      lte(workspaceContentPerformanceObservations.observedAt, input.requestedAt),
      cursorCondition,
      sql`not exists (
        select 1 from "workspace_content_performance_observations" as newer
        where newer."workspace_id" = ${input.workspaceId}
          and newer."post_id" = ${workspaceContentPerformanceObservations.postId}
          and newer."observed_at" <= ${input.requestedAt}
          and (newer."observed_at" > ${workspaceContentPerformanceObservations.observedAt}
            or (newer."observed_at" = ${workspaceContentPerformanceObservations.observedAt} and newer."id" > ${workspaceContentPerformanceObservations.id}))
      )`,
    )).orderBy(desc(workspaceContentPerformanceObservations.observedAt), desc(workspaceContentPerformanceObservations.id)).limit(limit + 1);
    const pageRows = rows.slice(0, limit);
    const postIds = [...new Set(pageRows.map((row) => row.postId))];
    const assetIds = [...new Set(pageRows.map((row) => row.sourceAssetId))];
    const rightsIds = [...new Set(pageRows.map((row) => row.rightsSnapshotId))];
    const [posts, assetRows, rightsRows] = await Promise.all([
      postIds.length ? getDb().select().from(socialPosts).where(and(eq(socialPosts.workspaceId, input.workspaceId), inArray(socialPosts.id, postIds))) : [],
      assetIds.length ? getDb().select({ id: assets.id, type: assets.type, checksum: assets.checksum, metadata: assets.metadata }).from(assets).where(and(eq(assets.workspaceId, input.workspaceId), inArray(assets.id, assetIds), isNull(assets.deletedAt))) : [],
      rightsIds.length ? getDb().select({ id: inspirationRightsSnapshots.id, revision: inspirationRightsSnapshots.revision, digest: inspirationRightsSnapshots.digest, snapshot: inspirationRightsSnapshots.snapshot }).from(inspirationRightsSnapshots).where(and(eq(inspirationRightsSnapshots.workspaceId, input.workspaceId), inArray(inspirationRightsSnapshots.id, rightsIds))) : [],
    ]);
    const accountIds = [...new Set(posts.map((post) => post.socialAccountId))];
    const accounts = accountIds.length ? await getDb().select({ id: socialAccounts.id, displayName: socialAccounts.displayName, platform: socialAccounts.platform }).from(socialAccounts).where(and(eq(socialAccounts.workspaceId, input.workspaceId), inArray(socialAccounts.id, accountIds))) : [];
    const postById = new Map(posts.map((post) => [post.id, post]));
    const assetById = new Map(assetRows.map((asset) => [asset.id, asset]));
    const accountById = new Map(accounts.map((account) => [account.id, account]));
    const rightsByIdentity = new Map(rightsRows.map((row) => [`${row.id}:${row.revision}:${row.digest}`, row]));
    const items = pageRows.flatMap((observation) => {
      const post = postById.get(observation.postId);
      const asset = assetById.get(observation.sourceAssetId);
      const account = post ? accountById.get(post.socialAccountId) : undefined;
      const stored = rightsByIdentity.get(`${observation.rightsSnapshotId}:${observation.rightsSnapshotRevision}:${observation.rightsSnapshotDigest}`);
      const rights = stored ? hydrateRightsSnapshot(stored.snapshot as InspirationRightsSnapshot) : null;
      const candidate = workspaceOwnedCandidateFromRecords({ workspaceId: input.workspaceId, observation, post, asset, account, rights, requestedAt: input.requestedAt });
      if (!candidate) return [];
      return [candidate];
    });
    const last = pageRows.at(-1);
    const hasMore = rows.length > limit;
    return { items, nextCursor: hasMore && last ? encodeCursor({ observedAt: last.observedAt.toISOString(), id: last.id }) : null, hasMore };
  },
};

function isHttpsUrl(value: string) {
  try { return new URL(value).protocol === "https:"; } catch { return false; }
}
