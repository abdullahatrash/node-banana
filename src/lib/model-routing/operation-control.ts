import { and, eq } from "drizzle-orm";
import type { getDb } from "@/lib/db";
import { resolveProviderKeyByRef } from "@/lib/byok/repository";
import type { OperationControlAdapter } from "@/lib/agent-runtime/operation-status/controls";
import { replicatePredictionIdentities } from "./db-schema";
import { ReplicateHttpClient } from "./replicate-http-client";
import { settleGenerationSpend } from "./generation-spend";

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
      // Replicate may bill work that was cancelled after it started. A provider
      // cancellation confirms the operation state, not a zero-dollar outcome.
      const quote = typeof operation.metadata.quoteAmountUsd === "number" && typeof operation.metadata.quoteQuantity === "number" ? operation.metadata.quoteAmountUsd * operation.metadata.quoteQuantity : 0;
      await settleGenerationSpend({ database: this.database(), workspaceId: operation.workspaceId, intentId: operation.resourceId, outcome: { kind: "cost_unknown" }, quotedAmountUsd: quote, at });
      return { kind: "confirmed_cancelled" as const };
    } catch { return { kind: "outcome_unknown" as const }; }
  }
  async retry() {
    // A paid retry requires a newly quoted/reserved Generation Intent; never clone one silently.
    return { kind: "conflict" as const };
  }
}
