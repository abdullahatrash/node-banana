import type { CostQuote, ExactModelRef } from "./types";

export interface GenerationBudgetAuthority {
  reserve(input: {
    workspaceId: string;
    principalId: string;
    intentId: string;
    model: ExactModelRef;
    quote: CostQuote;
    at: Date;
  }): Promise<
    | { kind: "reserved"; reservationIds: string[] }
    | { kind: "denied"; code: string }
    | { kind: "unavailable"; code: string }
  >;
}

/** Explicit fail-closed default for contexts that have not wired durable budget authority. */
export const DENYING_GENERATION_BUDGET_AUTHORITY: GenerationBudgetAuthority = {
  reserve: async () => ({ kind: "unavailable", code: "BUDGET_AUTHORITY_NOT_CONFIGURED" }),
};

/** Test-only in-memory authority; production uses the runtime BudgetService adapter. */
export class MemoryGenerationBudgetAuthority implements GenerationBudgetAuthority {
  readonly reservations = new Map<string, { amount: number; reservationIds: string[] }>();
  constructor(private readonly ceilingUsd = Number.POSITIVE_INFINITY) {}
  async reserve(input: Parameters<GenerationBudgetAuthority["reserve"]>[0]) {
    const existing = this.reservations.get(`${input.workspaceId}:${input.intentId}`);
    if (existing) return { kind: "reserved" as const, reservationIds: [...existing.reservationIds] };
    const amount = input.quote.amount * input.quote.quantity;
    if (amount > this.ceilingUsd) return { kind: "denied" as const, code: "BUDGET_LIMIT_EXCEEDED" };
    const reservationIds = [`generation:${input.workspaceId}:${input.intentId}`];
    this.reservations.set(`${input.workspaceId}:${input.intentId}`, { amount, reservationIds });
    return { kind: "reserved" as const, reservationIds };
  }
}
