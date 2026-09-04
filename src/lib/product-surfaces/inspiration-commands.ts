import "server-only";

import { and, desc, eq, isNull } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { assets, brandProfiles, workspaceProductRecords } from "@/lib/db/schema";
import { inspirationRightsSnapshots } from "@/lib/model-routing/db-schema";
import { hydrateRightsSnapshot, validateRightsEvidence } from "@/lib/model-routing/rights-evidence";
import type { ArabicVariety, ContentLanguage, InspirationRightsSnapshot } from "@/lib/model-routing/types";
import { createProductRecordInTransaction, ProductRecordConflictError } from "./repository";
import { inspirationPayloadSchema, type ContentFormat } from "./definitions";
import { compileBrandAwareRemixBrief } from "./remix-brief";

export class InspirationAdmissionError extends Error {
  constructor(readonly code: string) { super(code); }
}

export async function submitInspirationCommand(input: {
  workspaceId: string; userId: string; title: string; sourceName: string; sourceAssetId: string;
  rightsSnapshotId: string; region: string; contentLanguage: ContentLanguage;
  arabicVariety: ArabicVariety | null; format: ContentFormat; tags: string[]; idempotencyKey: string;
}) {
  return getDb().transaction(async (tx) => {
    const [[asset], [stored]] = await Promise.all([
      tx.select({ id: assets.id, type: assets.type, checksum: assets.checksum, metadata: assets.metadata }).from(assets).where(and(eq(assets.workspaceId, input.workspaceId), eq(assets.id, input.sourceAssetId), isNull(assets.deletedAt))).limit(1),
      tx.select({ snapshot: inspirationRightsSnapshots.snapshot }).from(inspirationRightsSnapshots).where(and(eq(inspirationRightsSnapshots.workspaceId, input.workspaceId), eq(inspirationRightsSnapshots.id, input.rightsSnapshotId))).orderBy(desc(inspirationRightsSnapshots.revision)).limit(1),
    ]);
    if (!asset || (asset.type !== "image" && asset.type !== "video") || asset.metadata?.uploadState !== "ready" || !asset.checksum) throw new InspirationAdmissionError("INSPIRATION_ASSET_NOT_READY");
    const rights = stored ? hydrateRightsSnapshot(stored.snapshot as InspirationRightsSnapshot) : null;
    if (!rights || rights.sourceAssetIds.length !== 1 || rights.sourceAssetIds[0] !== asset.id || !validateRightsEvidence({ workspaceId: input.workspaceId, basis: rights.basis, permittedRemix: rights.permittedRemix, sourceAssetIds: rights.sourceAssetIds, evidence: rights.evidence, at: new Date() }).ok) throw new InspirationAdmissionError("INSPIRATION_RIGHTS_NOT_ADMITTED");
    const rightsStatus = rights.basis === "licensed" ? "licensed" : "user_submitted";
    const now = new Date();
    return createProductRecordInTransaction(tx, { workspaceId: input.workspaceId, userId: input.userId, kind: "inspiration_item", title: input.title, state: "active", idempotencyKey: input.idempotencyKey, now, payload: {
      sourceUrl: `/api/studio/assets/${encodeURIComponent(asset.id)}/download`, sourceAssetId: asset.id, sourceMediaType: asset.type, sourceName: input.sourceName,
      capturedAt: now.toISOString(), metricsObservedAt: now.toISOString(), metrics: { views: 0, likes: 0 }, region: input.region,
      contentLanguage: input.contentLanguage, arabicVariety: input.arabicVariety, format: input.format, rightsStatus,
      rightsSnapshot: { id: rights.id, revision: rights.revision, digest: rights.digest }, permittedInfluence: ["topic", "hook", "pacing", "structure"],
      whyThisAppears: ["workspace_asset_submitted"], tags: input.tags,
    } });
  });
}

export async function queueInspirationCommand(input: { workspaceId: string; userId: string; inspirationItemId: string; idempotencyKey: string }) {
  return getDb().transaction(async (tx) => {
    const [record] = await tx.select().from(workspaceProductRecords).where(and(eq(workspaceProductRecords.workspaceId, input.workspaceId), eq(workspaceProductRecords.id, input.inspirationItemId), eq(workspaceProductRecords.kind, "inspiration_item"), isNull(workspaceProductRecords.archivedAt))).limit(1);
    if (!record) throw new ProductRecordConflictError("INSPIRATION_NOT_FOUND");
    const source = inspirationPayloadSchema.parse(record.payload);
    if (!source.sourceAssetId || !source.rightsSnapshot || source.rightsStatus === "restricted") throw new InspirationAdmissionError("INSPIRATION_RIGHTS_NOT_ADMITTED");
    const [[stored], [brand]] = await Promise.all([
      tx.select({ snapshot: inspirationRightsSnapshots.snapshot }).from(inspirationRightsSnapshots).where(and(eq(inspirationRightsSnapshots.workspaceId, input.workspaceId), eq(inspirationRightsSnapshots.id, source.rightsSnapshot.id), eq(inspirationRightsSnapshots.revision, source.rightsSnapshot.revision), eq(inspirationRightsSnapshots.digest, source.rightsSnapshot.digest))).limit(1),
      tx.select().from(brandProfiles).where(and(eq(brandProfiles.workspaceId, input.workspaceId), eq(brandProfiles.status, "active"))).orderBy(desc(brandProfiles.revision)).limit(1),
    ]);
    const rights = stored ? hydrateRightsSnapshot(stored.snapshot as InspirationRightsSnapshot) : null;
    if (!rights || !validateRightsEvidence({ workspaceId: input.workspaceId, basis: rights.basis, permittedRemix: rights.permittedRemix, sourceAssetIds: rights.sourceAssetIds, evidence: rights.evidence, at: new Date() }).ok) throw new InspirationAdmissionError("INSPIRATION_RIGHTS_EXPIRED");
    if (!brand?.acceptedAt) throw new InspirationAdmissionError("INSPIRATION_ACTIVE_BRAND_REQUIRED");
    const now = new Date();
    const remixBrief = compileBrandAwareRemixBrief({ inspirationItemId: record.id, inspirationRevision: record.revision, sourceValue: source, brand: { id: brand.id, revision: brand.revision, acceptedAt: brand.acceptedAt, profile: brand.profile }, permittedRemix: rights.permittedRemix, createdAt: now });
    return createProductRecordInTransaction(tx, { workspaceId: input.workspaceId, userId: input.userId, kind: "blitz_item", title: record.title, state: "queued", idempotencyKey: input.idempotencyKey, payload: {
      inspirationItemId: record.id, contentPieceId: null, sourceAttribution: source.sourceUrl, sourceAssetId: source.sourceAssetId, sourceMediaType: source.sourceMediaType,
      rightsSnapshot: source.rightsSnapshot, remixBrief,
      rightsBasis: rights.basis, permittedRemix: rights.permittedRemix, rightsEvidenceIds: rights.evidence.map((item) => item.id),
      contentLanguage: source.contentLanguage, arabicVariety: source.arabicVariety,
      format: source.format,
      rationale: remixBrief.brandDirection.angle.slice(0, 1_000), rejectionReasons: [],
    }, now });
  });
}
