import { and, eq } from "drizzle-orm";
import type { getDb } from "@/lib/db";
import { modelProviderEffectClaims, replicatePredictionIdentities } from "./db-schema";
import type { ProviderEffectClaimPort } from "./replicate-contract";

type Db = ReturnType<typeof getDb>;

/** The effect claim is durable before the provider call, preventing duplicate paid submissions. */
export class PostgresProviderEffectClaims implements ProviderEffectClaimPort {
  constructor(private readonly database: () => Db) {}

  async claim(input: Parameters<ProviderEffectClaimPort["claim"]>[0]) {
    return this.database().transaction(async (tx) => {
      const inserted = await tx.insert(modelProviderEffectClaims).values({
        workspaceId: input.workspaceId,
        intentId: input.intentId,
        provider: input.provider,
        state: "claimed",
        claimToken: input.claimToken,
        predictionId: null,
        claimedAt: input.at,
        updatedAt: input.at,
      }).onConflictDoNothing().returning({ claimToken: modelProviderEffectClaims.claimToken });
      if (inserted.length) return { kind: "claimed" as const };
      const [current] = await tx.select().from(modelProviderEffectClaims).where(and(eq(modelProviderEffectClaims.workspaceId, input.workspaceId), eq(modelProviderEffectClaims.intentId, input.intentId))).limit(1);
      if (!current) throw new Error("PROVIDER_EFFECT_CLAIM_UNAVAILABLE");
      return { kind: "existing" as const, state: current.state as "claimed" | "submitted" | "outcome_unknown", predictionId: current.predictionId };
    });
  }

  async bindPrediction(input: Parameters<ProviderEffectClaimPort["bindPrediction"]>[0]) {
    return this.database().transaction(async (tx) => {
      const [claim] = await tx.select().from(modelProviderEffectClaims).where(and(eq(modelProviderEffectClaims.workspaceId, input.workspaceId), eq(modelProviderEffectClaims.intentId, input.intentId))).for("update");
      if (!claim || claim.claimToken !== input.claimToken) return "conflict" as const;
      if (claim.state === "submitted") return claim.predictionId === input.predictionId ? "replayed" as const : "conflict" as const;
      if (claim.state !== "claimed") return "conflict" as const;
      await tx.insert(replicatePredictionIdentities).values({ workspaceId: input.workspaceId, intentId: input.intentId, predictionId: input.predictionId, model: input.model, createdAt: input.at }).onConflictDoNothing();
      const updated = await tx.update(modelProviderEffectClaims).set({ state: "submitted", predictionId: input.predictionId, updatedAt: input.at }).where(and(eq(modelProviderEffectClaims.workspaceId, input.workspaceId), eq(modelProviderEffectClaims.intentId, input.intentId), eq(modelProviderEffectClaims.claimToken, input.claimToken), eq(modelProviderEffectClaims.state, "claimed"))).returning({ intentId: modelProviderEffectClaims.intentId });
      return updated.length ? "bound" as const : "conflict" as const;
    });
  }

  async markOutcomeUnknown(input: Parameters<ProviderEffectClaimPort["markOutcomeUnknown"]>[0]) {
    await this.database().update(modelProviderEffectClaims).set({ state: "outcome_unknown", updatedAt: input.at }).where(and(eq(modelProviderEffectClaims.workspaceId, input.workspaceId), eq(modelProviderEffectClaims.intentId, input.intentId), eq(modelProviderEffectClaims.claimToken, input.claimToken), eq(modelProviderEffectClaims.state, "claimed")));
  }
}

/** Backward-compatible export name for imports outside this module. */
export { PostgresProviderEffectClaims as PostgresPredictionLedger };
