import { and, eq } from "drizzle-orm";
import type { getDb } from "@/lib/db";
import { modelFallbackSpendReservations, modelGenerationBudgetReservations } from "./db-schema";

type Db = ReturnType<typeof getDb>;
export type GenerationSpendOutcome =
  | { kind: "succeeded"; actualAmountUsd: number }
  | { kind: "pre_start_cancelled" }
  | { kind: "failed_known" }
  | { kind: "cost_unknown" };

export function generationSpendAmounts(outcome: GenerationSpendOutcome, quotedAmountUsd: number) {
  if (outcome.kind === "succeeded") return { status: "settled" as const, actualAmountUsd: outcome.actualAmountUsd.toFixed(6), releasedAmountUsd: "0" };
  if (outcome.kind === "pre_start_cancelled" || outcome.kind === "failed_known") return { status: "released" as const, actualAmountUsd: "0", releasedAmountUsd: quotedAmountUsd.toFixed(6) };
  return { status: "outcome_unknown" as const, actualAmountUsd: null, releasedAmountUsd: "0" };
}

/** One transaction owns both the Workspace reservation and optional fallback grant exposure. */
export async function settleGenerationSpend(input: { database: Db; workspaceId: string; intentId: string; outcome: GenerationSpendOutcome; quotedAmountUsd: number; at: Date }) {
  const amounts = generationSpendAmounts(input.outcome, input.quotedAmountUsd);
  await input.database.transaction(async (tx) => {
    await tx.update(modelGenerationBudgetReservations).set({ ...amounts, updatedAt: input.at }).where(and(eq(modelGenerationBudgetReservations.workspaceId, input.workspaceId), eq(modelGenerationBudgetReservations.intentId, input.intentId)));
    await tx.update(modelFallbackSpendReservations).set({ ...amounts, releasedAt: amounts.status === "released" ? input.at : null }).where(and(eq(modelFallbackSpendReservations.workspaceId, input.workspaceId), eq(modelFallbackSpendReservations.intentId, input.intentId)));
  });
  const commercialOutcome = input.outcome.kind === "succeeded" ? "succeeded" : input.outcome.kind === "cost_unknown" ? "outcome_unknown" : "failed_known";
  const { COMMERCIAL } = await import("@/lib/commercial/production");
  await COMMERCIAL.settleGenerationEffect({ workspaceId: input.workspaceId, intentId: input.intentId, outcome: commercialOutcome });
}
