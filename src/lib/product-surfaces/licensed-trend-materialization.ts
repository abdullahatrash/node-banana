import "server-only";

import { createHash } from "node:crypto";
import { and, asc, eq, lte, or, sql } from "drizzle-orm";
import { canonicalDigest } from "@/lib/agent-tools/canonical";
import { getDb } from "@/lib/db";
import {
  licensedTrendCatalogEntries, licensedTrendCatalogRevisions, licensedTrendMaterializationJobs,
  licensedTrendWorkspaceEntitlements,
} from "@/lib/db/schema";
import { inspirationRightsSnapshots } from "@/lib/model-routing/db-schema";
import { hydrateRightsSnapshot } from "@/lib/model-routing/rights-evidence";
import { createImmutableRightsEvidence } from "@/lib/model-routing/rights-evidence-repository";
import type { InspirationRightsSnapshot } from "@/lib/model-routing/types";
import { copyObjectInS3, getObjectStreamFromS3 } from "@/lib/storage";
import { finalizeAssetUpload, recordPendingS3AssetWithQuota } from "@/lib/studio/repository";
import { inspirationPayloadSchema } from "./definitions";
import { licensedTrendCatalogDocumentSchema, type LicensedTrendCatalogDocument } from "./licensed-trend-types";
import { createProductRecordInTransaction } from "./repository";

type ClaimedJob = typeof licensedTrendMaterializationJobs.$inferSelect & { leaseOwner: string; leaseExpiresAt: Date };
const stableId = (prefix: string, value: string) => `${prefix}_${createHash("sha256").update(value).digest("hex").slice(0, 32)}`;

async function verifyCopiedObject(input: { key: string; digest: string; sizeBytes: number; mimeType: string }) {
  const stored = await getObjectStreamFromS3({ key: input.key });
  if (stored.contentLength !== input.sizeBytes || (stored.contentType && stored.contentType !== input.mimeType)) throw new Error("LICENSED_TREND_COPY_IDENTITY_MISMATCH");
  const hash = createHash("sha256"); let size = 0;
  for await (const chunk of stored.body) { size += chunk.byteLength; hash.update(chunk); }
  if (size !== input.sizeBytes || `sha256:${hash.digest("hex")}` !== input.digest) throw new Error("LICENSED_TREND_COPY_DIGEST_MISMATCH");
}

async function claim(workerId: string, at: Date): Promise<ClaimedJob | null> {
  const leaseExpiresAt = new Date(at.getTime() + 5 * 60_000);
  return getDb().transaction(async (tx) => {
    await tx.update(licensedTrendMaterializationJobs).set({ state: "failed_known", leaseOwner: null, leaseExpiresAt: null, failureCode: "MATERIALIZATION_ATTEMPTS_EXHAUSTED", finishedAt: at, updatedAt: at }).where(and(eq(licensedTrendMaterializationJobs.state, "claimed"), lte(licensedTrendMaterializationJobs.leaseExpiresAt, at), sql`${licensedTrendMaterializationJobs.attempt} >= ${licensedTrendMaterializationJobs.maxAttempts}`));
    const [due] = await tx.select().from(licensedTrendMaterializationJobs).where(or(
      and(eq(licensedTrendMaterializationJobs.state, "queued"), lte(licensedTrendMaterializationJobs.nextAttemptAt, at), sql`${licensedTrendMaterializationJobs.attempt} < ${licensedTrendMaterializationJobs.maxAttempts}`),
      and(eq(licensedTrendMaterializationJobs.state, "claimed"), lte(licensedTrendMaterializationJobs.leaseExpiresAt, at), sql`${licensedTrendMaterializationJobs.attempt} < ${licensedTrendMaterializationJobs.maxAttempts}`),
    )).orderBy(asc(licensedTrendMaterializationJobs.nextAttemptAt), asc(licensedTrendMaterializationJobs.id)).limit(1).for("update", { skipLocked: true });
    if (!due) return null;
    const [row] = await tx.update(licensedTrendMaterializationJobs).set({ state: "claimed", leaseOwner: workerId, leaseExpiresAt, leaseGeneration: sql`${licensedTrendMaterializationJobs.leaseGeneration} + 1`, attempt: sql`${licensedTrendMaterializationJobs.attempt} + 1`, failureCode: null, updatedAt: at }).where(and(eq(licensedTrendMaterializationJobs.workspaceId, due.workspaceId), eq(licensedTrendMaterializationJobs.id, due.id), eq(licensedTrendMaterializationJobs.leaseGeneration, due.leaseGeneration))).returning();
    if (!row?.leaseOwner || !row.leaseExpiresAt) return null;
    return row as ClaimedJob;
  });
}

const owned = (job: ClaimedJob) => and(eq(licensedTrendMaterializationJobs.workspaceId, job.workspaceId), eq(licensedTrendMaterializationJobs.id, job.id), eq(licensedTrendMaterializationJobs.state, "claimed"), eq(licensedTrendMaterializationJobs.leaseOwner, job.leaseOwner), eq(licensedTrendMaterializationJobs.leaseGeneration, job.leaseGeneration));

async function loadActivePackage(job: ClaimedJob, at: Date) {
  const [row] = await getDb().select({ entitlement: licensedTrendWorkspaceEntitlements, head: licensedTrendCatalogEntries, revision: licensedTrendCatalogRevisions }).from(licensedTrendWorkspaceEntitlements)
    .innerJoin(licensedTrendCatalogEntries, eq(licensedTrendCatalogEntries.id, licensedTrendWorkspaceEntitlements.catalogId))
    .innerJoin(licensedTrendCatalogRevisions, and(eq(licensedTrendCatalogRevisions.catalogId, licensedTrendWorkspaceEntitlements.catalogId), eq(licensedTrendCatalogRevisions.revision, licensedTrendWorkspaceEntitlements.catalogRevision)))
    .where(and(eq(licensedTrendWorkspaceEntitlements.workspaceId, job.workspaceId), eq(licensedTrendWorkspaceEntitlements.id, job.entitlementId), eq(licensedTrendWorkspaceEntitlements.catalogId, job.catalogId), eq(licensedTrendWorkspaceEntitlements.catalogRevision, job.catalogRevision), eq(licensedTrendWorkspaceEntitlements.catalogDigest, job.catalogDigest))).limit(1);
  if (!row || row.entitlement.state !== "active" || row.head.state !== "active" || (row.entitlement.expiresAt && row.entitlement.expiresAt <= at) || (row.revision.rightsExpiresAt && row.revision.rightsExpiresAt <= at)) throw new Error("LICENSED_TREND_ENTITLEMENT_INACTIVE");
  return { ...row, document: licensedTrendCatalogDocumentSchema.parse(row.revision.document) };
}

async function materializeAsset(input: { job: ClaimedJob; object: LicensedTrendCatalogDocument["media"] | LicensedTrendCatalogDocument["evidenceDocument"]; destinationKey: string; type: "image" | "video" | "document"; label: string }) {
  const pending = await recordPendingS3AssetWithQuota({ workspaceId: input.job.workspaceId, userId: input.job.requestedByUserId, type: input.type, storageBucket: process.env.S3_BUCKET_NAME || null, storageKey: input.destinationKey, mimeType: input.object.mimeType, originalFileName: `${input.job.catalogId}-${input.label}`, expectedSizeBytes: input.object.sizeBytes, metadata: { source: "licensed_trend_catalog", catalogId: input.job.catalogId, catalogRevision: input.job.catalogRevision, catalogDigest: input.job.catalogDigest, materializationJobId: input.job.id } });
  await copyObjectInS3({ sourceKey: input.object.storageKey, destinationKey: input.destinationKey, sourceVersionId: input.object.versionId, sourceETag: input.object.etag });
  await verifyCopiedObject({ key: input.destinationKey, digest: input.object.digest, sizeBytes: input.object.sizeBytes, mimeType: input.object.mimeType });
  return finalizeAssetUpload({ workspaceId: input.job.workspaceId, assetId: pending.id, uploadState: "ready", sizeBytes: input.object.sizeBytes, checksum: input.object.digest, mimeType: input.object.mimeType, width: "width" in input.object ? input.object.width : undefined, height: "height" in input.object ? input.object.height : undefined, durationSeconds: "durationSeconds" in input.object ? input.object.durationSeconds : undefined, metadata: { sourceObjectVersionId: input.object.versionId, sourceObjectETag: input.object.etag, verifiedCopyDigest: input.object.digest } });
}

async function processClaimed(job: ClaimedJob, at: Date) {
  const catalog = await loadActivePackage(job, at);
  const [sourceAsset, evidenceAsset] = await Promise.all([
    materializeAsset({ job, object: catalog.document.media, destinationKey: job.sourceDestinationKey, type: catalog.document.media.type, label: "source", }),
    materializeAsset({ job, object: catalog.document.evidenceDocument, destinationKey: job.evidenceDestinationKey, type: "document", label: "license-evidence" }),
  ]);
  const evidenceResult = await createImmutableRightsEvidence({ workspaceId: job.workspaceId, userId: job.requestedByUserId, idempotencyKey: `${job.id}:evidence`, sourceAssetId: sourceAsset.id, basis: "licensed", permittedRemix: catalog.document.rights.permittedRemix, issuer: catalog.document.rights.issuer, scope: catalog.document.rights.scope, evidenceDocumentAssetId: evidenceAsset.id, sourceUrl: catalog.document.provider.sourceUrl, issuedAt: new Date(catalog.document.rights.issuedAt), expiresAt: catalog.document.rights.expiresAt ? new Date(catalog.document.rights.expiresAt) : null, at });
  if (evidenceResult.kind !== "created" && evidenceResult.kind !== "replayed") throw new Error("code" in evidenceResult ? evidenceResult.code : "RIGHTS_EVIDENCE_INVALID");
  const rightsInput = { basis: "licensed" as const, permittedRemix: catalog.document.rights.permittedRemix, evidence: [evidenceResult.evidence], sourceAssetIds: [sourceAsset.id] };
  const snapshotId = stableId("rights", `${job.workspaceId}:${job.id}`);
  const snapshot: InspirationRightsSnapshot = { schema: "inspiration-rights-snapshot/v1", id: snapshotId, workspaceId: job.workspaceId, revision: 1, ...rightsInput, digest: canonicalDigest(rightsInput) as `sha256:${string}`, createdByUserId: job.requestedByUserId, createdAt: at };
  return getDb().transaction(async (tx) => {
    const [[lease], [active]] = await Promise.all([
      tx.select().from(licensedTrendMaterializationJobs).where(owned(job)).limit(1).for("update"),
      tx.select({ entitlement: licensedTrendWorkspaceEntitlements, head: licensedTrendCatalogEntries, revision: licensedTrendCatalogRevisions }).from(licensedTrendWorkspaceEntitlements).innerJoin(licensedTrendCatalogEntries, eq(licensedTrendCatalogEntries.id, licensedTrendWorkspaceEntitlements.catalogId)).innerJoin(licensedTrendCatalogRevisions, and(eq(licensedTrendCatalogRevisions.catalogId, licensedTrendWorkspaceEntitlements.catalogId), eq(licensedTrendCatalogRevisions.revision, licensedTrendWorkspaceEntitlements.catalogRevision))).where(and(eq(licensedTrendWorkspaceEntitlements.workspaceId, job.workspaceId), eq(licensedTrendWorkspaceEntitlements.id, job.entitlementId))).limit(1).for("share"),
    ]);
    if (!lease || !active || active.entitlement.state !== "active" || active.head.state !== "active" || active.revision.documentDigest !== job.catalogDigest || (active.entitlement.expiresAt && active.entitlement.expiresAt <= at) || (active.revision.rightsExpiresAt && active.revision.rightsExpiresAt <= at)) throw new Error("LICENSED_TREND_LEASE_OR_ENTITLEMENT_LOST");
    const [stored] = await tx.insert(inspirationRightsSnapshots).values({ workspaceId: snapshot.workspaceId, id: snapshot.id, revision: 1, snapshot, digest: snapshot.digest, basis: snapshot.basis, permittedRemix: snapshot.permittedRemix, createdByUserId: snapshot.createdByUserId, createdAt: snapshot.createdAt }).onConflictDoNothing().returning({ snapshot: inspirationRightsSnapshots.snapshot });
    const [existing] = stored ? [stored] : await tx.select({ snapshot: inspirationRightsSnapshots.snapshot }).from(inspirationRightsSnapshots).where(and(eq(inspirationRightsSnapshots.workspaceId, snapshot.workspaceId), eq(inspirationRightsSnapshots.id, snapshot.id), eq(inspirationRightsSnapshots.revision, 1))).limit(1);
    const persisted = existing ? hydrateRightsSnapshot(existing.snapshot as InspirationRightsSnapshot) : null;
    if (!persisted || persisted.digest !== snapshot.digest) throw new Error("LICENSED_TREND_RIGHTS_CONFLICT");
    const payload = inspirationPayloadSchema.parse({
      sourceUrl: `/api/studio/assets/${encodeURIComponent(sourceAsset.id)}/download`, sourceAssetId: sourceAsset.id, sourceMediaType: catalog.document.media.type,
      sourceName: catalog.document.sourceName, capturedAt: at.toISOString(), metricsObservedAt: catalog.document.metrics.observedAt,
      metrics: { views: catalog.document.metrics.views, likes: catalog.document.metrics.likes, comments: catalog.document.metrics.comments }, region: catalog.document.classification.region,
      contentLanguage: catalog.document.classification.contentLanguage, arabicVariety: catalog.document.classification.arabicVariety, format: catalog.document.classification.format,
      rightsStatus: "licensed", rightsSnapshot: { id: persisted.id, revision: persisted.revision, digest: persisted.digest }, permittedInfluence: ["topic", "hook", "pacing", "structure"],
      creativePrimitives: catalog.document.classification.creativePrimitives, whyThisAppears: ["licensed_catalog", "licensed_rights"], tags: catalog.document.classification.tags,
      trendEvidence: null, catalogBinding: { catalogId: job.catalogId, revision: job.catalogRevision, digest: job.catalogDigest, entitlementId: job.entitlementId, materializationJobId: job.id },
    });
    const record = await createProductRecordInTransaction(tx, { workspaceId: job.workspaceId, userId: job.requestedByUserId, kind: "inspiration_item", title: catalog.document.title, state: "active", payload, idempotencyKey: `licensed-trend:${job.id}`, now: at });
    const [completed] = await tx.update(licensedTrendMaterializationJobs).set({ state: "succeeded", leaseOwner: null, leaseExpiresAt: null, sourceAssetId: sourceAsset.id, evidenceDocumentAssetId: evidenceAsset.id, rightsEvidenceId: evidenceResult.evidence.id, rightsSnapshotId: persisted.id, inspirationItemId: record.id, failureCode: null, finishedAt: at, updatedAt: at }).where(owned(job)).returning();
    if (!completed) throw new Error("LICENSED_TREND_LEASE_LOST");
    return completed;
  });
}

function failureCode(error: unknown) { return error instanceof Error && /^[A-Z0-9_]{4,120}$/.test(error.message) ? error.message : "LICENSED_TREND_MATERIALIZATION_FAILED"; }

export class LicensedTrendMaterializationWorker {
  async run(input: { workerId: string; limit: number; at?: Date }) {
    const summary = { claimed: 0, succeeded: 0, retried: 0, failed: 0 };
    for (let index = 0; index < input.limit; index += 1) {
      const at = input.at ?? new Date(); const job = await claim(input.workerId, at); if (!job) break; summary.claimed += 1;
      try { await processClaimed(job, at); summary.succeeded += 1; }
      catch (error) {
        const terminal = job.attempt >= job.maxAttempts || failureCode(error) === "LICENSED_TREND_ENTITLEMENT_INACTIVE";
        const [updated] = await getDb().update(licensedTrendMaterializationJobs).set({ state: terminal ? "failed_known" : "queued", leaseOwner: null, leaseExpiresAt: null, failureCode: failureCode(error), nextAttemptAt: new Date(at.getTime() + Math.min(60, 2 ** job.attempt) * 60_000), finishedAt: terminal ? at : null, updatedAt: at }).where(owned(job)).returning({ id: licensedTrendMaterializationJobs.id });
        if (updated) { if (terminal) summary.failed += 1; else summary.retried += 1; }
      }
    }
    return summary;
  }
}

export const PRODUCTION_LICENSED_TREND_MATERIALIZATION_WORKER = new LicensedTrendMaterializationWorker();
