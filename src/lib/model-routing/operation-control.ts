import { and, eq } from "drizzle-orm";
import type { getDb } from "@/lib/db";
import { resolveProviderKeyByRef } from "@/lib/byok/repository";
import type { OperationControlAdapter } from "@/lib/agent-runtime/operation-status/controls";
import { modelFallbackSpendReservations, modelGenerationBudgetReservations, replicatePredictionIdentities } from "./db-schema";
import { ReplicateHttpClient } from "./replicate-http-client";

type Db = ReturnType<typeof getDb>;

export class GenerationOperationControlAdapter implements OperationControlAdapter {
  readonly supportsCancel = true;
  readonly supportsRetry = false;
  constructor(private readonly database: () => Db) {}
  async cancel(operation: Parameters<OperationControlAdapter["cancel"]>[0]) {
    const [identity] = await this.database().select({ predictionId: replicatePredictionIdentities.predictionId, credentialRef: replicatePredictionIdentities.credentialRef }).from(replicatePredictionIdentities).where(and(eq(replicatePredictionIdentities.workspaceId, operation.workspaceId), eq(replicatePredictionIdentities.intentId, operation.resourceId))).limit(1);
    // The provider may have accepted work before its identity could be bound. Never
    // report cancellation or release money when there is nothing safe to cancel.
    if (!identity?.credentialRef) return { kind: "outcome_unknown" as const };
    try {
      const token = await resolveProviderKeyByRef(operation.workspaceId, identity.credentialRef);
      if (!token) return { kind: "outcome_unknown" as const };
      const prediction = await new ReplicateHttpClient(() => token).cancel(identity.predictionId);
      if (prediction.status !== "canceled" && prediction.status !== "aborted") return { kind: "accepted" as const };
      const at = new Date();
      await this.database().transaction(async (tx) => {
        const [budget] = await tx.select({ quoted: modelGenerationBudgetReservations.quotedAmountUsd }).from(modelGenerationBudgetReservations).where(and(eq(modelGenerationBudgetReservations.workspaceId, operation.workspaceId), eq(modelGenerationBudgetReservations.intentId, operation.resourceId))).limit(1);
        await tx.update(modelGenerationBudgetReservations).set({ status: "released", actualAmountUsd: "0", releasedAmountUsd: budget?.quoted ?? "0", updatedAt: at }).where(and(eq(modelGenerationBudgetReservations.workspaceId, operation.workspaceId), eq(modelGenerationBudgetReservations.intentId, operation.resourceId)));
        await tx.update(modelFallbackSpendReservations).set({ status: "released", actualAmountUsd: "0", releasedAmountUsd: budget?.quoted ?? "0", releasedAt: at }).where(and(eq(modelFallbackSpendReservations.workspaceId, operation.workspaceId), eq(modelFallbackSpendReservations.intentId, operation.resourceId)));
      });
      return { kind: "confirmed_cancelled" as const };
    } catch { return { kind: "outcome_unknown" as const }; }
  }
  async retry() {
    // A paid retry requires a newly quoted/reserved Generation Intent; never clone one silently.
    return { kind: "conflict" as const };
  }
}
