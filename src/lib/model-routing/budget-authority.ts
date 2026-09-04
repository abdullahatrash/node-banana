import type { CostQuote, ExactModelRef, GenerationFundingMode } from "./types";

export interface ManagedCreditQuote {
  schema: "managed-generation-credit-quote/v1";
  quoteId: string;
  intentId: string;
  totalDebitUnits: number;
  currency: "USD";
  subtotalMinor: number;
  taxMinor: number;
  totalMinor: number;
  expiresAt: string;
  pricingSnapshotDigest: `sha256:${string}`;
  confirmationDigest: `sha256:${string}`;
}

export interface ManagedCreditQuoteAcceptance {
  quoteId: string;
  confirmationDigest: `sha256:${string}`;
}

export interface GenerationBudgetAuthority {
  reserve(input: {
    workspaceId: string;
    principalId: string;
    intentId: string;
    model: ExactModelRef;
    quote: CostQuote;
    fundingMode?: GenerationFundingMode;
    managedQuoteAcceptance?: ManagedCreditQuoteAcceptance | null;
    at: Date;
  }): Promise<
    | { kind: "reserved"; reservationIds: string[]; disposition: "created" | "replayed" }
    | { kind: "confirmation_required"; quote: ManagedCreditQuote }
    | { kind: "denied"; code: string }
    | { kind: "unavailable"; code: string }
  >;
  release(input: { workspaceId: string; intentId: string; at: Date }): Promise<void>;
}

/** Explicit fail-closed default for contexts that have not wired durable budget authority. */
export const DENYING_GENERATION_BUDGET_AUTHORITY: GenerationBudgetAuthority = {
  reserve: async () => ({ kind: "unavailable", code: "BUDGET_AUTHORITY_NOT_CONFIGURED" }),
  release: async () => undefined,
};

/** Test-only in-memory authority; production uses the runtime BudgetService adapter. */
export class MemoryGenerationBudgetAuthority implements GenerationBudgetAuthority {
  readonly reservations = new Map<string, { quotedAmount: number; actualAmount: number | null; releasedAmount: number; status: "held" | "settled" | "released" | "outcome_unknown"; reservationIds: string[] }>();
  constructor(private readonly ceilingUsd = Number.POSITIVE_INFINITY) {}
  async reserve(input: Parameters<GenerationBudgetAuthority["reserve"]>[0]) {
    const existing = this.reservations.get(`${input.workspaceId}:${input.intentId}`);
    if (existing) return existing.status !== "released" && existing.quotedAmount === input.quote.amount * input.quote.quantity ? { kind: "reserved" as const, reservationIds: [...existing.reservationIds], disposition: "replayed" as const } : { kind: "unavailable" as const, code: "BUDGET_RESERVATION_CONFLICT" };
    const amount = input.quote.amount * input.quote.quantity;
    const consumed = [...this.reservations.values()].reduce((sum, row) => sum + (row.status === "settled" ? row.actualAmount ?? row.quotedAmount : row.status === "released" ? 0 : row.quotedAmount), 0);
    if (consumed + amount > this.ceilingUsd) return { kind: "denied" as const, code: "BUDGET_LIMIT_EXCEEDED" };
    const reservationIds = [`generation:${input.workspaceId}:${input.intentId}`];
    this.reservations.set(`${input.workspaceId}:${input.intentId}`, { quotedAmount: amount, actualAmount: null, releasedAmount: 0, status: "held", reservationIds });
    return { kind: "reserved" as const, reservationIds, disposition: "created" as const };
  }
  async release(input: { workspaceId: string; intentId: string }) { const row = this.reservations.get(`${input.workspaceId}:${input.intentId}`); if (row?.status === "held") this.reservations.set(`${input.workspaceId}:${input.intentId}`, { ...row, status: "released", actualAmount: 0, releasedAmount: row.quotedAmount }); }
}
