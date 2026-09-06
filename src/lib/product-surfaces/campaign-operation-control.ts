import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import type { getDb } from "@/lib/db";
import { productCampaignOccurrences } from "@/lib/db/schema";
import type { OperationControlAdapter } from "@/lib/agent-runtime/operation-status/controls";

type Db = ReturnType<typeof getDb>;

export class CampaignOccurrenceOperationControl implements OperationControlAdapter {
  readonly supportsCancel = true;
  readonly supportsRetry = true;
  constructor(private readonly database: Db, private readonly clock = () => new Date()) {}

  async cancel(operation: Parameters<OperationControlAdapter["cancel"]>[0]) {
    return this.database.transaction(async (tx) => {
      const [row] = await tx.select().from(productCampaignOccurrences).where(and(eq(productCampaignOccurrences.workspaceId, operation.workspaceId), eq(productCampaignOccurrences.id, operation.resourceId))).limit(1).for("update");
      if (!row) return { kind: "unavailable" as const };
      if (row.state === "cancelled") return { kind: "confirmed_cancelled" as const };
      if (["succeeded", "failed_known"].includes(row.state)) return { kind: "conflict" as const };
      const now = this.clock();
      if (["scheduled", "claimed"].includes(row.state)) {
        const updated = await tx.update(productCampaignOccurrences).set({ state: "cancelled", leaseToken: null, leaseExpiresAt: null, failureCode: "PRE_START_CANCELLED", completedAt: now, updatedAt: now }).where(and(eq(productCampaignOccurrences.workspaceId, row.workspaceId), eq(productCampaignOccurrences.id, row.id), eq(productCampaignOccurrences.state, row.state))).returning({ id: productCampaignOccurrences.id });
        return updated.length ? { kind: "confirmed_cancelled" as const } : { kind: "conflict" as const };
      }
      if (row.state === "submitting" && !row.workflowRunId) {
        await tx.update(productCampaignOccurrences).set({ state: "outcome_unknown", failureCode: "CANCEL_DURING_SUBMISSION_IDENTITY_UNKNOWN", updatedAt: now }).where(and(eq(productCampaignOccurrences.workspaceId, row.workspaceId), eq(productCampaignOccurrences.id, row.id), eq(productCampaignOccurrences.state, "submitting")));
      }
      return { kind: "outcome_unknown" as const };
    });
  }

  async retry(operation: Parameters<OperationControlAdapter["retry"]>[0]) {
    return this.database.transaction(async (tx) => {
      const [source] = await tx.select().from(productCampaignOccurrences).where(and(eq(productCampaignOccurrences.workspaceId, operation.workspaceId), eq(productCampaignOccurrences.id, operation.resourceId), inArray(productCampaignOccurrences.state, ["failed_known", "cancelled"]))).limit(1).for("update");
      if (!source) return { kind: "conflict" as const };
      const id = randomUUID(); const occurrenceKey = `${source.occurrenceKey}:retry:${id}`; const now = this.clock();
      await tx.insert(productCampaignOccurrences).values({ workspaceId: source.workspaceId, id, campaignId: source.campaignId, campaignRevision: source.campaignRevision, campaignDigest: source.campaignDigest, occurrenceKey, scheduledAt: now, format: source.format, snapshot: { ...(source.snapshot as Record<string, unknown>), scheduledAt: now.toISOString(), occurrenceKey }, state: "scheduled", createdAt: now, updatedAt: now });
      return { kind: "accepted" as const, resourceId: id, metadata: { retrySourceOccurrenceId: source.id, nextAction: "wait_for_campaign_runtime" } };
    });
  }
}
