import "server-only";

import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, isNull, lte } from "drizzle-orm";
import { canonicalDigest } from "@/lib/agent-tools/canonical";
import { getDb } from "@/lib/db";
import { productBlitzReplenishmentItems, productBlitzReplenishmentRuns, workspaceProductRecords } from "@/lib/db/schema";
import { inspirationRightsSnapshots } from "@/lib/model-routing/db-schema";
import { hydrateRightsSnapshot, validateRightsEvidence } from "@/lib/model-routing/rights-evidence";
import type { InspirationRightsSnapshot } from "@/lib/model-routing/types";
import { blitzPayloadSchema, campaignPayloadSchema, inspirationPayloadSchema } from "./definitions";
import { createProductRecordInTransaction } from "./repository";
import type { BlitzReplenishmentContext, BlitzReplenishmentRepository, ClaimedBlitzReplenishment } from "./blitz-replenisher";

type Executor = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

async function context(executor: Executor, workspaceId: string, campaignId: string, now: Date): Promise<BlitzReplenishmentContext> {
  const [campaignRow] = await executor.select().from(workspaceProductRecords).where(and(eq(workspaceProductRecords.workspaceId, workspaceId), eq(workspaceProductRecords.id, campaignId), eq(workspaceProductRecords.kind, "campaign_automation"), eq(workspaceProductRecords.state, "active"), isNull(workspaceProductRecords.archivedAt))).limit(1);
  if (!campaignRow) throw new Error("BLITZ_CAMPAIGN_NOT_ACTIVE");
  const campaign = campaignPayloadSchema.parse(campaignRow.payload);
  const perProposal = campaign.execution.creditCeiling > 0 ? Math.floor(campaign.execution.budgetCents / campaign.execution.creditCeiling) : 0;
  const records = await executor.select().from(workspaceProductRecords).where(and(eq(workspaceProductRecords.workspaceId, workspaceId), inArray(workspaceProductRecords.kind, ["inspiration_item", "blitz_item"]), isNull(workspaceProductRecords.archivedAt))).orderBy(asc(workspaceProductRecords.createdAt), asc(workspaceProductRecords.id)).limit(1_000);
  const queued = records.filter((row) => row.kind === "blitz_item" && ["queued", "accepted", "editing"].includes(row.state)).map((row) => blitzPayloadSchema.parse(row.payload));
  const existingSourceIds = new Set(queued.flatMap((item) => item.inspirationItemId ? [item.inspirationItemId] : []));
  const candidates = records.filter((row) => row.kind === "inspiration_item" && ["active", "saved"].includes(row.state));
  const sources = [];
  for (const row of candidates) {
    const source = inspirationPayloadSchema.parse(row.payload);
    let rightsAdmitted = false;
    if (source.rightsSnapshot && source.sourceAssetId && source.rightsStatus !== "restricted") {
      const [stored] = await executor.select({ snapshot: inspirationRightsSnapshots.snapshot }).from(inspirationRightsSnapshots).where(and(eq(inspirationRightsSnapshots.workspaceId, workspaceId), eq(inspirationRightsSnapshots.id, source.rightsSnapshot.id), eq(inspirationRightsSnapshots.revision, source.rightsSnapshot.revision), eq(inspirationRightsSnapshots.digest, source.rightsSnapshot.digest))).limit(1);
      const rights = stored ? hydrateRightsSnapshot(stored.snapshot as InspirationRightsSnapshot) : null;
      rightsAdmitted = Boolean(rights && validateRightsEvidence({ workspaceId, basis: rights.basis, permittedRemix: rights.permittedRemix, sourceAssetIds: rights.sourceAssetIds, evidence: rights.evidence, at: now }).ok);
    }
    sources.push({ id: row.id, format: source.format, contentLanguage: source.contentLanguage, rightsAdmitted, observedAt: new Date(source.metricsObservedAt), views: source.metrics.views, likes: source.metrics.likes });
  }
  return {
    policy: { mode: campaign.execution.replenishmentMode, targetCapacity: campaign.execution.blitzTargetCapacity, maximumCreatesPerRun: campaign.execution.blitzMaximumCreatesPerRun, prospectiveSpendCeilingCents: campaign.execution.budgetCents, perProposalGenerationCeilingCents: perProposal, remixRatio: campaign.remixRatio, executionMode: campaign.execution.mode, contentLanguage: campaign.contentLanguage, formatMix: campaign.formatMix },
    sources, queuedCount: queued.length, queuedRemixCount: queued.filter((item) => item.inspirationItemId).length, existingSourceIds,
    prospectiveCommittedCents: queued.reduce((sum, item) => sum + (item.generationCeilingCents || perProposal), 0),
  };
}

function run(row: typeof productBlitzReplenishmentRuns.$inferSelect, replenishmentContext: BlitzReplenishmentContext): ClaimedBlitzReplenishment {
  if (!row.leaseToken) throw new Error("BLITZ_REPLENISHMENT_LEASE_MISSING");
  return { workspaceId: row.workspaceId, runId: row.id, leaseToken: row.leaseToken, sourceKey: row.sourceKey, invocation: row.invocation as "daily" | "manual", context: replenishmentContext };
}

export class PostgresBlitzReplenishmentRepository implements BlitzReplenishmentRepository {
  async claim(input: { workspaceId: string; campaignId: string; invocation: "daily" | "manual"; sourceKey: string; actorUserId: string; now: Date; leaseUntil: Date }) {
    return getDb().transaction(async (tx) => {
      const [prior] = await tx.select().from(productBlitzReplenishmentRuns).where(and(eq(productBlitzReplenishmentRuns.workspaceId, input.workspaceId), eq(productBlitzReplenishmentRuns.campaignId, input.campaignId), eq(productBlitzReplenishmentRuns.sourceKey, input.sourceKey))).limit(1).for("update");
      if (prior?.state === "succeeded") return { kind: "replayed" as const, created: prior.createdCount, stopReason: prior.stopReason ?? "completed" };
      if (prior?.state === "claimed" && prior.leaseExpiresAt && prior.leaseExpiresAt > input.now) return { kind: "busy" as const };
      const replenishmentContext = await context(tx, input.workspaceId, input.campaignId, input.now);
      if (prior) {
        const leaseToken = randomUUID();
        const [reclaimed] = await tx.update(productBlitzReplenishmentRuns).set({ state: "claimed", leaseToken, leaseExpiresAt: input.leaseUntil, leaseGeneration: prior.leaseGeneration + 1, failureCode: null, completedAt: null, updatedAt: input.now }).where(and(eq(productBlitzReplenishmentRuns.workspaceId, input.workspaceId), eq(productBlitzReplenishmentRuns.id, prior.id), eq(productBlitzReplenishmentRuns.leaseGeneration, prior.leaseGeneration))).returning();
        if (!reclaimed) return { kind: "busy" as const };
        return { kind: "claimed" as const, run: run(reclaimed, replenishmentContext) };
      }
      const leaseToken = randomUUID(); const id = randomUUID();
      const [created] = await tx.insert(productBlitzReplenishmentRuns).values({ workspaceId: input.workspaceId, id, campaignId: input.campaignId, sourceKey: input.sourceKey, invocation: input.invocation, actorUserId: input.actorUserId, state: "claimed", leaseToken, leaseExpiresAt: input.leaseUntil, leaseGeneration: 1, policySnapshot: structuredClone(replenishmentContext.policy) as unknown as Record<string, unknown>, createdAt: input.now, updatedAt: input.now }).returning();
      return { kind: "claimed" as const, run: run(created, replenishmentContext) };
    });
  }

  async append(input: Parameters<BlitzReplenishmentRepository["append"]>[0]) {
    return getDb().transaction(async (tx) => {
      const [owned] = await tx.select().from(productBlitzReplenishmentRuns).where(and(eq(productBlitzReplenishmentRuns.workspaceId, input.run.workspaceId), eq(productBlitzReplenishmentRuns.id, input.run.runId), eq(productBlitzReplenishmentRuns.state, "claimed"), eq(productBlitzReplenishmentRuns.leaseToken, input.run.leaseToken))).limit(1).for("update");
      if (!owned) throw new Error("BLITZ_REPLENISHMENT_LEASE_LOST");
      let created = 0; let replayed = 0;
      for (const [position, selected] of input.selected.entries()) {
        const [sourceRow] = await tx.select().from(workspaceProductRecords).where(and(eq(workspaceProductRecords.workspaceId, input.run.workspaceId), eq(workspaceProductRecords.id, selected.id), eq(workspaceProductRecords.kind, "inspiration_item"), isNull(workspaceProductRecords.archivedAt))).limit(1);
        if (!sourceRow) continue;
        const source = inspirationPayloadSchema.parse(sourceRow.payload);
        if (!source.rightsSnapshot || !source.sourceAssetId || source.rightsStatus === "restricted") continue;
        const [stored] = await tx.select({ snapshot: inspirationRightsSnapshots.snapshot }).from(inspirationRightsSnapshots).where(and(eq(inspirationRightsSnapshots.workspaceId, input.run.workspaceId), eq(inspirationRightsSnapshots.id, source.rightsSnapshot.id), eq(inspirationRightsSnapshots.revision, source.rightsSnapshot.revision), eq(inspirationRightsSnapshots.digest, source.rightsSnapshot.digest))).limit(1);
        const rights = stored ? hydrateRightsSnapshot(stored.snapshot as InspirationRightsSnapshot) : null;
        if (!rights || !validateRightsEvidence({ workspaceId: input.run.workspaceId, basis: rights.basis, permittedRemix: rights.permittedRemix, sourceAssetIds: rights.sourceAssetIds, evidence: rights.evidence, at: input.now }).ok) continue;
        const selectionDigest = canonicalDigest({ sourceId: selected.id, views: selected.views, likes: selected.likes, observedAt: selected.observedAt.toISOString(), policy: input.run.context.policy });
        const record = await createProductRecordInTransaction(tx, { workspaceId: input.run.workspaceId, userId: owned.actorUserId, kind: "blitz_item", title: sourceRow.title, state: "queued", idempotencyKey: `blitz-replenish:${input.run.runId}:${selected.id}`, now: input.now, payload: {
          campaignId: owned.campaignId, replenishmentRunId: owned.id, inspirationItemId: sourceRow.id, contentPieceId: null, sourceAttribution: source.sourceUrl, sourceAssetId: source.sourceAssetId, sourceMediaType: source.sourceMediaType,
          rightsSnapshot: source.rightsSnapshot, remixBrief: { influences: source.permittedInfluence, protectedExpressionExcluded: true }, rightsBasis: rights.basis, permittedRemix: rights.permittedRemix, rightsEvidenceIds: rights.evidence.map((item) => item.id),
          contentLanguage: source.contentLanguage, arabicVariety: source.arabicVariety, format: source.format, rationale: "bounded_rights_cleared_replenishment", rejectionReasons: [],
          sourceComparison: { views: selected.views, likes: selected.likes, observedAt: selected.observedAt.toISOString(), selectionDigest }, executionMode: input.run.context.policy.executionMode, generationCeilingCents: input.run.context.policy.perProposalGenerationCeilingCents,
        } });
        const inserted = await tx.insert(productBlitzReplenishmentItems).values({ workspaceId: input.run.workspaceId, runId: input.run.runId, position, sourceRecordId: sourceRow.id, blitzItemId: record.id, rationaleDigest: selectionDigest, createdAt: input.now }).onConflictDoNothing().returning({ id: productBlitzReplenishmentItems.blitzItemId });
        if (inserted.length) created++; else replayed++;
      }
      return { created, replayed };
    });
  }

  async complete(input: Parameters<BlitzReplenishmentRepository["complete"]>[0]) {
    const rows = await getDb().update(productBlitzReplenishmentRuns).set({ state: "succeeded", createdCount: input.created, stopReason: input.stopReason, leaseToken: null, leaseExpiresAt: null, completedAt: input.now, updatedAt: input.now }).where(and(eq(productBlitzReplenishmentRuns.workspaceId, input.run.workspaceId), eq(productBlitzReplenishmentRuns.id, input.run.runId), eq(productBlitzReplenishmentRuns.state, "claimed"), eq(productBlitzReplenishmentRuns.leaseToken, input.run.leaseToken))).returning({ id: productBlitzReplenishmentRuns.id });
    if (!rows.length) throw new Error("BLITZ_REPLENISHMENT_LEASE_LOST");
  }

  async fail(input: Parameters<BlitzReplenishmentRepository["fail"]>[0]) {
    await getDb().update(productBlitzReplenishmentRuns).set({ state: "failed_known", failureCode: input.code.slice(0, 500), leaseToken: null, leaseExpiresAt: null, completedAt: input.now, updatedAt: input.now }).where(and(eq(productBlitzReplenishmentRuns.workspaceId, input.run.workspaceId), eq(productBlitzReplenishmentRuns.id, input.run.runId), eq(productBlitzReplenishmentRuns.state, "claimed"), eq(productBlitzReplenishmentRuns.leaseToken, input.run.leaseToken)));
  }

  async recoverExpired(input: { at: Date; limit?: number }) {
    return getDb().transaction(async (tx) => {
      const rows = await tx.select().from(productBlitzReplenishmentRuns).where(and(eq(productBlitzReplenishmentRuns.state, "claimed"), lte(productBlitzReplenishmentRuns.leaseExpiresAt, input.at))).orderBy(asc(productBlitzReplenishmentRuns.leaseExpiresAt), asc(productBlitzReplenishmentRuns.id)).limit(Math.min(100, Math.max(1, input.limit ?? 50))).for("update", { skipLocked: true });
      return rows.length;
    });
  }
}

export const PRODUCTION_BLITZ_REPLENISHMENT_REPOSITORY = new PostgresBlitzReplenishmentRepository();
