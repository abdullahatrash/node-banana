import "server-only";

import { createHash } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { canonicalDigest } from "@/lib/agent-tools/canonical";
import { getDb } from "@/lib/db";
import { assets, socialPosts, workspaceContentPerformanceObservations } from "@/lib/db/schema";
import { inspirationRightsSnapshots } from "@/lib/model-routing/db-schema";
import { hydrateRightsSnapshot, validateRightsEvidence } from "@/lib/model-routing/rights-evidence";
import type { InspirationRightsSnapshot } from "@/lib/model-routing/types";
import { ARABIC_VARIETIES, CONTENT_FORMATS } from "./definitions";
import { ensureWorkspaceOwnedTrendSource } from "./workspace-owned-trend-adapter";

const digest = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const identifier = z.string().trim().min(1).max(200);
const safeCount = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const nullableSafeCount = safeCount.nullable();
type Executor = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

export const workspacePerformanceObservationInputSchema = z.object({
  postId: identifier,
  sourceAssetId: identifier,
  rightsSnapshot: z.object({ id: identifier, revision: z.number().int().positive(), digest }).strict(),
  sourceRef: z.string().trim().min(1).max(500),
  metrics: z.object({ views: safeCount, likes: safeCount, comments: safeCount.default(0) }).strict(),
  observedAt: z.string().datetime({ offset: true }),
  region: z.string().trim().min(1).max(80),
  contentLanguage: z.enum(["ar", "en"]),
  arabicVariety: z.enum(ARABIC_VARIETIES).nullable(),
  format: z.enum(CONTENT_FORMATS),
  tags: z.array(z.string().trim().min(1).max(80)).max(30),
  idempotencyKey: z.string().trim().min(8).max(200),
}).strict().superRefine((value, context) => {
  if (value.contentLanguage !== "ar" && value.arabicVariety) context.addIssue({ code: "custom", path: ["arabicVariety"], message: "Arabic variety requires Arabic content." });
});

export class WorkspacePerformanceObservationError extends Error {
  constructor(readonly code: string) { super(code); }
}

function stableId(workspaceId: string, idempotencyKey: string) {
  return `wpo_${createHash("sha256").update(`${workspaceId}:${idempotencyKey}`).digest("hex").slice(0, 32)}`;
}

function readyAsset(asset: { type: string; checksum: string | null; metadata: Record<string, unknown> | null } | undefined) {
  return Boolean(asset && asset.type === "video" && asset.checksum && asset.metadata?.uploadState === "ready");
}

async function admittedSource(executor: Executor, input: { workspaceId: string; postId: string; sourceAssetId: string; rightsSnapshot: { id: string; revision: number; digest: string } }, observedAt: Date, capturedAt: Date) {
  const [[post], [asset], [storedRights]] = await Promise.all([
    executor.select().from(socialPosts).where(and(eq(socialPosts.workspaceId, input.workspaceId), eq(socialPosts.id, input.postId))).limit(1),
    executor.select({ id: assets.id, type: assets.type, checksum: assets.checksum, metadata: assets.metadata }).from(assets).where(and(eq(assets.workspaceId, input.workspaceId), eq(assets.id, input.sourceAssetId), isNull(assets.deletedAt))).limit(1),
    executor.select({ snapshot: inspirationRightsSnapshots.snapshot }).from(inspirationRightsSnapshots).where(and(eq(inspirationRightsSnapshots.workspaceId, input.workspaceId), eq(inspirationRightsSnapshots.id, input.rightsSnapshot.id), eq(inspirationRightsSnapshots.revision, input.rightsSnapshot.revision), eq(inspirationRightsSnapshots.digest, input.rightsSnapshot.digest))).limit(1),
  ]);
  const media = post?.stableMediaRefs.find((reference) => (reference.resourceKind ?? "studio_asset") === "studio_asset" && reference.assetId === input.sourceAssetId);
  if (!post || post.status !== "published" || !post.publishedAt || !post.platformPostUrl || !isHttpsUrl(post.platformPostUrl) || !post.platformPostId) throw new WorkspacePerformanceObservationError("PERFORMANCE_POST_NOT_PUBLISHED");
  if (observedAt < post.publishedAt) throw new WorkspacePerformanceObservationError("PERFORMANCE_OBSERVATION_DATE_INVALID");
  if (!readyAsset(asset) || !media || media.assetDigest !== asset!.checksum) throw new WorkspacePerformanceObservationError("PERFORMANCE_SOURCE_ASSET_INVALID");
  const rights = storedRights ? hydrateRightsSnapshot(storedRights.snapshot as InspirationRightsSnapshot) : null;
  const rightsValid = rights && rights.basis === "owned" && rights.sourceAssetIds.length === 1 && rights.sourceAssetIds[0] === asset!.id && rights.createdAt <= observedAt && validateRightsEvidence({ workspaceId: input.workspaceId, basis: rights.basis, permittedRemix: rights.permittedRemix, sourceAssetIds: rights.sourceAssetIds, evidence: rights.evidence, at: capturedAt }).ok;
  if (!rightsValid) throw new WorkspacePerformanceObservationError("PERFORMANCE_RIGHTS_NOT_ADMITTED");
  return { post, asset: asset!, rights };
}

export async function recordWorkspacePerformanceObservation(input: z.infer<typeof workspacePerformanceObservationInputSchema> & { workspaceId: string; userId: string; at?: Date }) {
  const capturedAt = input.at ?? new Date();
  const observedAt = new Date(input.observedAt);
  if (!Number.isFinite(observedAt.getTime()) || observedAt > capturedAt) throw new WorkspacePerformanceObservationError("PERFORMANCE_OBSERVATION_DATE_INVALID");
  const tags = [...new Set(input.tags.map((tag) => tag.normalize("NFKC").trim()).filter(Boolean))].slice(0, 30);
  const request = {
    postId: input.postId, sourceAssetId: input.sourceAssetId, rightsSnapshot: input.rightsSnapshot,
    sourceRef: input.sourceRef, metrics: input.metrics, observedAt: observedAt.toISOString(), region: input.region,
    contentLanguage: input.contentLanguage, arabicVariety: input.arabicVariety, format: input.format, tags,
  };
  const requestDigest = canonicalDigest(request) as `sha256:${string}`;
  const sourceDigest = canonicalDigest({ schema: "workspace-performance-attestation/v1", workspaceId: input.workspaceId, actorUserId: input.userId, ...request }) as `sha256:${string}`;
  const id = stableId(input.workspaceId, input.idempotencyKey);

  const result = await getDb().transaction(async (tx) => {
    const { post, asset, rights } = await admittedSource(tx, input, observedAt, capturedAt);

    const values = {
      workspaceId: input.workspaceId, id, postId: post.id, sourceAssetId: asset.id,
      rightsSnapshotId: rights.id, rightsSnapshotRevision: rights.revision, rightsSnapshotDigest: rights.digest,
      sourceKind: "workspace_attested", sourceRef: input.sourceRef, sourceDigest,
      views: input.metrics.views, likes: input.metrics.likes, comments: input.metrics.comments,
      region: input.region, contentLanguage: input.contentLanguage, arabicVariety: input.arabicVariety, format: input.format, tags,
      observedAt, capturedAt, createdByUserId: input.userId, idempotencyKey: input.idempotencyKey, requestDigest,
    };
    const [created] = await tx.insert(workspaceContentPerformanceObservations).values(values).onConflictDoNothing({ target: [workspaceContentPerformanceObservations.workspaceId, workspaceContentPerformanceObservations.idempotencyKey] }).returning();
    if (created) return { kind: "created" as const, observation: created };
    const [existing] = await tx.select().from(workspaceContentPerformanceObservations).where(and(eq(workspaceContentPerformanceObservations.workspaceId, input.workspaceId), eq(workspaceContentPerformanceObservations.idempotencyKey, input.idempotencyKey))).limit(1);
    if (!existing || existing.requestDigest !== requestDigest) throw new WorkspacePerformanceObservationError("PERFORMANCE_OBSERVATION_IDEMPOTENCY_CONFLICT");
    return { kind: "replayed" as const, observation: existing };
  });
  await ensureWorkspaceOwnedTrendSource({ workspaceId: input.workspaceId, userId: input.userId, at: capturedAt });
  return result;
}

export const platformVerifiedPerformanceObservationSchema = z.object({
  postId: identifier,
  sourceAssetId: identifier,
  rightsSnapshot: z.object({ id: identifier, revision: z.number().int().positive(), digest }).strict(),
  platform: z.enum(["instagram", "tiktok", "youtube"]),
  socialAccountId: identifier,
  providerAccountId: identifier,
  providerPostId: identifier,
  providerRequestId: identifier.nullable(),
  sourceRef: z.string().url().max(500).refine((value) => new URL(value).protocol === "https:"),
  metrics: z.object({ views: nullableSafeCount, likes: nullableSafeCount, comments: nullableSafeCount, shares: nullableSafeCount }).strict().refine((value) => Object.values(value).some((metric) => metric !== null)),
  observedAt: z.date(),
  region: z.string().trim().min(1).max(80),
  contentLanguage: z.enum(["ar", "en"]),
  arabicVariety: z.enum(ARABIC_VARIETIES).nullable(),
  format: z.enum(CONTENT_FORMATS),
  tags: z.array(z.string().trim().min(1).max(80)).max(30),
  idempotencyKey: z.string().trim().min(8).max(200),
}).strict();

export async function recordPlatformVerifiedPerformanceObservation(input: z.infer<typeof platformVerifiedPerformanceObservationSchema> & { workspaceId: string; userId: string; at?: Date }) {
  const capturedAt = input.at ?? new Date();
  if (input.observedAt > capturedAt) throw new WorkspacePerformanceObservationError("PERFORMANCE_OBSERVATION_DATE_INVALID");
  const reportedMetrics = (["views", "likes", "comments", "shares"] as const).filter((name) => input.metrics[name] !== null);
  const tags = [...new Set(input.tags.map((tag) => tag.normalize("NFKC").trim()).filter(Boolean))].slice(0, 30);
  const safeReceipt = { platform: input.platform, providerAccountId: input.providerAccountId, providerPostId: input.providerPostId, providerRequestId: input.providerRequestId, sourceRef: input.sourceRef, metrics: input.metrics, reportedMetrics };
  const sourceDigest = canonicalDigest({ schema: "platform-performance-observation/v1", ...safeReceipt }) as `sha256:${string}`;
  const request = { ...safeReceipt, postId: input.postId, sourceAssetId: input.sourceAssetId, rightsSnapshot: input.rightsSnapshot, observedAt: input.observedAt.toISOString(), region: input.region, contentLanguage: input.contentLanguage, arabicVariety: input.arabicVariety, format: input.format, tags };
  const requestDigest = canonicalDigest(request) as `sha256:${string}`;
  const id = stableId(input.workspaceId, input.idempotencyKey);
  const result = await getDb().transaction(async (tx) => {
    const { post, asset, rights } = await admittedSource(tx, input, input.observedAt, capturedAt);
    if (post.platformPostId !== input.providerPostId || post.socialAccountId !== input.socialAccountId) throw new WorkspacePerformanceObservationError("PERFORMANCE_PROVIDER_OWNERSHIP_MISMATCH");
    const values = {
      workspaceId: input.workspaceId, id, postId: post.id, sourceAssetId: asset.id,
      rightsSnapshotId: rights.id, rightsSnapshotRevision: rights.revision, rightsSnapshotDigest: rights.digest,
      sourceKind: "platform_verified", sourceRef: input.sourceRef, sourceDigest,
      views: input.metrics.views, likes: input.metrics.likes, comments: input.metrics.comments,
      platform: input.platform, providerAccountId: input.providerAccountId, providerPostId: input.providerPostId, providerRequestId: input.providerRequestId,
      reportedMetrics, providerReceipt: safeReceipt,
      region: input.region, contentLanguage: input.contentLanguage, arabicVariety: input.arabicVariety, format: input.format, tags,
      observedAt: input.observedAt, capturedAt, createdByUserId: input.userId, idempotencyKey: input.idempotencyKey, requestDigest,
    };
    const [created] = await tx.insert(workspaceContentPerformanceObservations).values(values).onConflictDoNothing().returning();
    if (created) return { kind: "created" as const, observation: created };
    const [existing] = await tx.select().from(workspaceContentPerformanceObservations).where(and(eq(workspaceContentPerformanceObservations.workspaceId, input.workspaceId), eq(workspaceContentPerformanceObservations.sourceKind, "platform_verified"), eq(workspaceContentPerformanceObservations.sourceDigest, sourceDigest))).limit(1);
    if (existing) return { kind: "replayed" as const, observation: existing };
    const [idempotent] = await tx.select().from(workspaceContentPerformanceObservations).where(and(eq(workspaceContentPerformanceObservations.workspaceId, input.workspaceId), eq(workspaceContentPerformanceObservations.idempotencyKey, input.idempotencyKey))).limit(1);
    if (!idempotent || idempotent.requestDigest !== requestDigest) throw new WorkspacePerformanceObservationError("PERFORMANCE_OBSERVATION_IDEMPOTENCY_CONFLICT");
    return { kind: "replayed" as const, observation: idempotent };
  });
  await ensureWorkspaceOwnedTrendSource({ workspaceId: input.workspaceId, userId: input.userId, at: capturedAt });
  return result;
}

function isHttpsUrl(value: string) {
  try { return new URL(value).protocol === "https:"; } catch { return false; }
}
