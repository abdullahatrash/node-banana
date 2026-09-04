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
    const [[post], [asset], [storedRights]] = await Promise.all([
      tx.select().from(socialPosts).where(and(eq(socialPosts.workspaceId, input.workspaceId), eq(socialPosts.id, input.postId))).limit(1),
      tx.select({ id: assets.id, type: assets.type, checksum: assets.checksum, metadata: assets.metadata }).from(assets).where(and(eq(assets.workspaceId, input.workspaceId), eq(assets.id, input.sourceAssetId), isNull(assets.deletedAt))).limit(1),
      tx.select({ snapshot: inspirationRightsSnapshots.snapshot }).from(inspirationRightsSnapshots).where(and(eq(inspirationRightsSnapshots.workspaceId, input.workspaceId), eq(inspirationRightsSnapshots.id, input.rightsSnapshot.id), eq(inspirationRightsSnapshots.revision, input.rightsSnapshot.revision), eq(inspirationRightsSnapshots.digest, input.rightsSnapshot.digest))).limit(1),
    ]);
    const media = post?.stableMediaRefs.find((reference) => (reference.resourceKind ?? "studio_asset") === "studio_asset" && reference.assetId === input.sourceAssetId);
    if (!post || post.status !== "published" || !post.publishedAt || !post.platformPostUrl || !isHttpsUrl(post.platformPostUrl)) throw new WorkspacePerformanceObservationError("PERFORMANCE_POST_NOT_PUBLISHED");
    if (observedAt < post.publishedAt) throw new WorkspacePerformanceObservationError("PERFORMANCE_OBSERVATION_DATE_INVALID");
    if (!readyAsset(asset) || !media || media.assetDigest !== asset!.checksum) throw new WorkspacePerformanceObservationError("PERFORMANCE_SOURCE_ASSET_INVALID");
    const rights = storedRights ? hydrateRightsSnapshot(storedRights.snapshot as InspirationRightsSnapshot) : null;
    const rightsValid = rights && rights.basis === "owned" && rights.sourceAssetIds.length === 1 && rights.sourceAssetIds[0] === asset!.id && rights.createdAt <= observedAt && validateRightsEvidence({ workspaceId: input.workspaceId, basis: rights.basis, permittedRemix: rights.permittedRemix, sourceAssetIds: rights.sourceAssetIds, evidence: rights.evidence, at: capturedAt }).ok;
    if (!rightsValid) throw new WorkspacePerformanceObservationError("PERFORMANCE_RIGHTS_NOT_ADMITTED");

    const values = {
      workspaceId: input.workspaceId, id, postId: post.id, sourceAssetId: asset!.id,
      rightsSnapshotId: rights!.id, rightsSnapshotRevision: rights!.revision, rightsSnapshotDigest: rights!.digest,
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

function isHttpsUrl(value: string) {
  try { return new URL(value).protocol === "https:"; } catch { return false; }
}
