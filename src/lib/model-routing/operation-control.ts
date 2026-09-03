import { and, eq } from "drizzle-orm";
import type { getDb } from "@/lib/db";
import { resolveInferenceKey } from "@/lib/byok/resolveInferenceKey";
import type { OperationControlAdapter } from "@/lib/agent-runtime/operation-status/controls";
import { modelGenerationBudgetReservations, replicatePredictionIdentities } from "./db-schema";
import { ReplicateHttpClient } from "./replicate-http-client";

type Db = ReturnType<typeof getDb>;

export class GenerationOperationControlAdapter implements OperationControlAdapter {
  constructor(private readonly database: () => Db) {}
  async cancel(operation: Parameters<OperationControlAdapter["cancel"]>[0]) {
    const [identity] = await this.database().select({ predictionId: replicatePredictionIdentities.predictionId }).from(replicatePredictionIdentities).where(and(eq(replicatePredictionIdentities.workspaceId, operation.workspaceId), eq(replicatePredictionIdentities.intentId, operation.resourceId))).limit(1);
    if (!identity) { await this.database().update(modelGenerationBudgetReservations).set({ status: "released", updatedAt: new Date() }).where(and(eq(modelGenerationBudgetReservations.workspaceId, operation.workspaceId), eq(modelGenerationBudgetReservations.intentId, operation.resourceId), eq(modelGenerationBudgetReservations.status, "held"))); return { kind: "confirmed_cancelled" as const }; }
    try {
      const token = await resolveInferenceKey({ headerKey: null, workspaceId: operation.workspaceId, provider: "replicate" });
      const prediction = await new ReplicateHttpClient(() => token).cancel(identity.predictionId);
      return prediction.status === "canceled" || prediction.status === "aborted" ? { kind: "confirmed_cancelled" as const } : { kind: "accepted" as const };
    } catch { return { kind: "outcome_unknown" as const }; }
  }
  async retry() {
    // A paid retry requires a newly quoted/reserved Generation Intent; never clone one silently.
    return { kind: "conflict" as const };
  }
}
