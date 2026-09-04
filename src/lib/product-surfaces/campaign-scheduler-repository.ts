import "server-only";

import { randomUUID } from "node:crypto";
import { and, asc, count, desc, eq, gte, inArray, lte, or } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { productCampaignOccurrences, workflowRunMutationReceipts, workflowRuns } from "@/lib/db/schema";
import type { CampaignSchedulerRepository, ClaimedCampaignOccurrence, ScheduledCampaignSnapshot } from "./campaign-scheduler";

type StoredSnapshot = Omit<ScheduledCampaignSnapshot, "scheduledAt"> & { scheduledAt: string };

function storedSnapshot(plan: ScheduledCampaignSnapshot): StoredSnapshot {
  return { ...structuredClone(plan), scheduledAt: plan.scheduledAt.toISOString() };
}

function claimed(row: typeof productCampaignOccurrences.$inferSelect): ClaimedCampaignOccurrence {
  const snapshot = row.snapshot as unknown as StoredSnapshot;
  if (!row.leaseToken || !snapshot.actor || !snapshot.workflow) throw new Error("CAMPAIGN_OCCURRENCE_SNAPSHOT_INVALID");
  return { ...snapshot, scheduledAt: new Date(snapshot.scheduledAt), id: row.id, leaseToken: row.leaseToken };
}

export class PostgresCampaignSchedulerRepository implements CampaignSchedulerRepository {
  async schedule(workspaceId: string, plans: ScheduledCampaignSnapshot[]) {
    return getDb().transaction(async (tx) => {
      const campaignGroups = new Map<string, ScheduledCampaignSnapshot[]>();
      for (const plan of plans) {
        if (plan.workspaceId !== workspaceId) throw new Error("CAMPAIGN_OCCURRENCE_WORKSPACE_MISMATCH");
        campaignGroups.set(plan.campaignId, [...(campaignGroups.get(plan.campaignId) ?? []), plan]);
      }
      let inserted = 0;
      for (const [campaignId, group] of campaignGroups) {
        const [usage] = await tx.select({ value: count() }).from(productCampaignOccurrences).where(and(
          eq(productCampaignOccurrences.workspaceId, workspaceId),
          eq(productCampaignOccurrences.campaignId, campaignId),
          inArray(productCampaignOccurrences.state, ["scheduled", "claimed", "submitting", "running", "succeeded", "outcome_unknown"]),
        ));
        const ceiling = Math.max(0, group[0]?.creditCeiling ?? 0);
        const available = Math.max(0, ceiling - Number(usage?.value ?? 0));
        const selected = group.slice(0, available);
        if (!selected.length) continue;
        const rows = await tx.insert(productCampaignOccurrences).values(selected.map((plan) => ({
          workspaceId, id: randomUUID(), campaignId: plan.campaignId, campaignRevision: plan.campaignRevision,
          campaignDigest: plan.campaignDigest, occurrenceKey: plan.occurrenceKey, scheduledAt: plan.scheduledAt,
          format: plan.format, snapshot: storedSnapshot(plan), state: "scheduled", createdAt: new Date(), updatedAt: new Date(),
        }))).onConflictDoNothing().returning({ id: productCampaignOccurrences.id });
        inserted += rows.length;
      }
      return { inserted, replayed: Math.max(0, plans.length - inserted) };
    });
  }

  async cancelFuture(workspaceId: string, campaignId: string, after: Date) {
    const rows = await getDb().update(productCampaignOccurrences).set({ state: "cancelled", completedAt: new Date(), updatedAt: new Date(), leaseToken: null, leaseExpiresAt: null, failureCode: "CAMPAIGN_PAUSED" }).where(and(
      eq(productCampaignOccurrences.workspaceId, workspaceId), eq(productCampaignOccurrences.campaignId, campaignId),
      inArray(productCampaignOccurrences.state, ["scheduled", "claimed"]),
      gte(productCampaignOccurrences.scheduledAt, after),
    )).returning({ id: productCampaignOccurrences.id });
    return rows.length;
  }

  async claimDue(input: { workerId: string; now: Date; leaseUntil: Date; limit: number }) {
    return getDb().transaction(async (tx) => {
      const due = await tx.select().from(productCampaignOccurrences).where(and(
        lte(productCampaignOccurrences.scheduledAt, input.now),
        or(eq(productCampaignOccurrences.state, "scheduled"), and(eq(productCampaignOccurrences.state, "claimed"), lte(productCampaignOccurrences.leaseExpiresAt, input.now))),
      )).orderBy(asc(productCampaignOccurrences.scheduledAt), asc(productCampaignOccurrences.id)).limit(Math.min(50, Math.max(1, input.limit))).for("update", { skipLocked: true });
      const rows = [];
      for (const row of due) {
        const leaseToken = `${input.workerId}:${randomUUID()}`;
        const [updated] = await tx.update(productCampaignOccurrences).set({ state: "claimed", leaseToken, leaseExpiresAt: input.leaseUntil, leaseGeneration: row.leaseGeneration + 1, updatedAt: input.now }).where(and(eq(productCampaignOccurrences.workspaceId, row.workspaceId), eq(productCampaignOccurrences.id, row.id), eq(productCampaignOccurrences.leaseGeneration, row.leaseGeneration))).returning();
        if (updated) rows.push(updated);
      }
      return rows.map(claimed);
    });
  }

  async markSubmitting(input: { occurrence: ClaimedCampaignOccurrence; quoteId: string; quotedAmount: string; currency: string; now: Date }) {
    const rows = await getDb().update(productCampaignOccurrences).set({ state: "submitting", leaseToken: null, leaseExpiresAt: null, quoteId: input.quoteId, quotedAmount: input.quotedAmount, currency: input.currency, updatedAt: input.now }).where(and(eq(productCampaignOccurrences.workspaceId, input.occurrence.workspaceId), eq(productCampaignOccurrences.id, input.occurrence.id), eq(productCampaignOccurrences.state, "claimed"), eq(productCampaignOccurrences.leaseToken, input.occurrence.leaseToken))).returning({ id: productCampaignOccurrences.id });
    return rows.length === 1;
  }

  async bindRun(input: Parameters<CampaignSchedulerRepository["bindRun"]>[0]) {
    const rows = await getDb().update(productCampaignOccurrences).set({ state: "running", workflowRunId: input.runId, startSnapshotDigest: input.startSnapshotDigest, quoteId: input.quoteId, quotedAmount: input.quotedAmount, currency: input.currency, updatedAt: input.acceptedAt }).where(and(eq(productCampaignOccurrences.workspaceId, input.occurrence.workspaceId), eq(productCampaignOccurrences.id, input.occurrence.id), eq(productCampaignOccurrences.state, "submitting"))).returning({ id: productCampaignOccurrences.id });
    if (rows.length !== 1) throw new Error("CAMPAIGN_OCCURRENCE_BIND_CONFLICT");
  }

  async fail(input: Parameters<CampaignSchedulerRepository["fail"]>[0]) {
    const state = input.outcomeUnknown ? "outcome_unknown" : "failed_known";
    await getDb().update(productCampaignOccurrences).set({ state, failureCode: input.code.slice(0, 500), completedAt: input.outcomeUnknown ? null : input.now, updatedAt: input.now, leaseToken: null, leaseExpiresAt: null }).where(and(eq(productCampaignOccurrences.workspaceId, input.occurrence.workspaceId), eq(productCampaignOccurrences.id, input.occurrence.id), inArray(productCampaignOccurrences.state, ["claimed", "submitting"])));
  }

  async markStaleSubmissionsUnknown(input: { before: Date; now: Date; limit?: number }) {
    return getDb().transaction(async (tx) => {
      const rows = await tx.select({ workspaceId: productCampaignOccurrences.workspaceId, id: productCampaignOccurrences.id }).from(productCampaignOccurrences).where(and(eq(productCampaignOccurrences.state, "submitting"), lte(productCampaignOccurrences.updatedAt, input.before))).orderBy(asc(productCampaignOccurrences.updatedAt), asc(productCampaignOccurrences.id)).limit(Math.min(100, Math.max(1, input.limit ?? 50))).for("update", { skipLocked: true });
      if (!rows.length) return 0;
      for (const row of rows) {
        const [occurrence] = await tx.select().from(productCampaignOccurrences).where(and(eq(productCampaignOccurrences.workspaceId, row.workspaceId), eq(productCampaignOccurrences.id, row.id))).limit(1);
        const snapshot = occurrence?.snapshot as unknown as StoredSnapshot | undefined;
        const actor = snapshot?.actor;
        const [receipt] = actor ? await tx.select({ runId: workflowRunMutationReceipts.runId }).from(workflowRunMutationReceipts).where(and(eq(workflowRunMutationReceipts.workspaceId, row.workspaceId), eq(workflowRunMutationReceipts.principalId, actor.principalId), eq(workflowRunMutationReceipts.keyId, actor.keyId), eq(workflowRunMutationReceipts.capability, "workflow_runs.start@2"), eq(workflowRunMutationReceipts.idempotencyKey, snapshot.occurrenceKey))).limit(1) : [];
        const [run] = receipt ? await tx.select({ id: workflowRuns.id, startSnapshotDigest: workflowRuns.startSnapshotDigest, state: workflowRuns.state }).from(workflowRuns).where(and(eq(workflowRuns.workspaceId, row.workspaceId), eq(workflowRuns.id, receipt.runId))).limit(1) : [];
        await tx.update(productCampaignOccurrences).set(run ? { state: run.state === "completed" ? "succeeded" : run.state === "failed" ? "failed_known" : "running", workflowRunId: run.id, startSnapshotDigest: run.startSnapshotDigest, failureCode: run.state === "failed" ? "WORKFLOW_RUN_FAILED" : null, completedAt: ["completed", "failed"].includes(run.state) ? input.now : null, updatedAt: input.now } : { state: "outcome_unknown", failureCode: "CAMPAIGN_WORKFLOW_SUBMISSION_IDENTITY_LOST", updatedAt: input.now }).where(and(eq(productCampaignOccurrences.workspaceId, row.workspaceId), eq(productCampaignOccurrences.id, row.id), eq(productCampaignOccurrences.state, "submitting")));
      }
      return rows.length;
    });
  }

  async reconcileWorkflowRuns(input: { now: Date; limit?: number }) {
    return getDb().transaction(async (tx) => {
      const rows = await tx.select({ workspaceId: productCampaignOccurrences.workspaceId, id: productCampaignOccurrences.id, state: workflowRuns.state, failureCode: workflowRuns.failureCode }).from(productCampaignOccurrences).innerJoin(workflowRuns, and(eq(workflowRuns.workspaceId, productCampaignOccurrences.workspaceId), eq(workflowRuns.id, productCampaignOccurrences.workflowRunId))).where(and(inArray(productCampaignOccurrences.state, ["running", "outcome_unknown"]), inArray(workflowRuns.state, ["completed", "failed", "cancelled"]))).orderBy(asc(productCampaignOccurrences.updatedAt), asc(productCampaignOccurrences.id)).limit(Math.min(100, Math.max(1, input.limit ?? 50))).for("update", { of: productCampaignOccurrences, skipLocked: true });
      for (const row of rows) await tx.update(productCampaignOccurrences).set({ state: row.state === "completed" ? "succeeded" : row.state === "cancelled" ? "cancelled" : "failed_known", failureCode: row.failureCode, completedAt: input.now, updatedAt: input.now }).where(and(eq(productCampaignOccurrences.workspaceId, row.workspaceId), eq(productCampaignOccurrences.id, row.id), inArray(productCampaignOccurrences.state, ["running", "outcome_unknown"])));
      return rows.length;
    });
  }
}

export const PRODUCTION_CAMPAIGN_SCHEDULER_REPOSITORY = new PostgresCampaignSchedulerRepository();

export async function listCampaignOccurrenceStatus(input: { workspaceId: string; campaignIds: string[]; limit?: number }) {
  if (!input.campaignIds.length) return [];
  const rows = await getDb().select({ id: productCampaignOccurrences.id, campaignId: productCampaignOccurrences.campaignId, state: productCampaignOccurrences.state, scheduledAt: productCampaignOccurrences.scheduledAt, format: productCampaignOccurrences.format, workflowRunId: productCampaignOccurrences.workflowRunId, quotedAmount: productCampaignOccurrences.quotedAmount, currency: productCampaignOccurrences.currency, failureCode: productCampaignOccurrences.failureCode, updatedAt: productCampaignOccurrences.updatedAt }).from(productCampaignOccurrences).where(and(eq(productCampaignOccurrences.workspaceId, input.workspaceId), inArray(productCampaignOccurrences.campaignId, input.campaignIds))).orderBy(desc(productCampaignOccurrences.scheduledAt), desc(productCampaignOccurrences.id)).limit(Math.min(200, Math.max(1, input.limit ?? 100)));
  return rows.map((row) => ({ ...row, scheduledAt: row.scheduledAt.toISOString(), updatedAt: row.updatedAt.toISOString() }));
}
