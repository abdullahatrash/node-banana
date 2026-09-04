import { canonicalDigest } from "@/lib/agent-tools/canonical";
import type { CommercialRepository } from "@/lib/commercial/repository";
import type { GenerationBudgetAuthority, ManagedCreditQuote } from "./budget-authority";

type ManagedCommercialPort = Pick<CommercialRepository, "issueQuote" | "acceptQuote" | "reserveQuote" | "settleGenerationEffect">;

type ManagedGenerationEnvironment = Readonly<Record<string, string | undefined>>;

function creditRate(environment: ManagedGenerationEnvironment): number | null {
  const value = Number(environment.MANAGED_GENERATION_USD_PER_CREDIT);
  return Number.isFinite(value) && value > 0 && value <= 100 ? value : null;
}

function field(value: unknown, key: string): unknown {
  return value && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined;
}

function quoteOffer(input: {
  workspaceId: string;
  intentId: string;
  quoteId: string;
  totalDebitUnits: number;
  subtotalMinor: number;
  expiresAt: Date;
  pricingSnapshotDigest: `sha256:${string}`;
}): ManagedCreditQuote {
  const facts = {
    schema: "managed-generation-credit-quote/v1" as const,
    quoteId: input.quoteId,
    intentId: input.intentId,
    totalDebitUnits: input.totalDebitUnits,
    currency: "USD" as const,
    subtotalMinor: input.subtotalMinor,
    taxMinor: 0,
    totalMinor: input.subtotalMinor,
    expiresAt: input.expiresAt.toISOString(),
    pricingSnapshotDigest: input.pricingSnapshotDigest,
  };
  return { ...facts, confirmationDigest: canonicalDigest({ workspaceId: input.workspaceId, ...facts }) as `sha256:${string}` };
}

/** Applies the Workspace USD ceiling to both lanes, then adds a fixed credit reservation for managed execution. */
export class ManagedGenerationBudgetAuthority implements GenerationBudgetAuthority {
  constructor(
    private readonly runtime: GenerationBudgetAuthority,
    private readonly commercial: ManagedCommercialPort,
    private readonly environment: ManagedGenerationEnvironment = process.env,
  ) {}

  async reserve(input: Parameters<GenerationBudgetAuthority["reserve"]>[0]) {
    if ((input.fundingMode ?? "byok") === "byok") return this.runtime.reserve(input);
    if (input.model.provider !== "replicate") {
      return { kind: "unavailable" as const, code: "MANAGED_PROVIDER_UNAVAILABLE" };
    }
    const rate = creditRate(this.environment);
    if (!rate) {
      return { kind: "unavailable" as const, code: "MANAGED_CREDIT_PRICING_UNAVAILABLE" };
    }
    const totalUsd = input.quote.amount * input.quote.quantity;
    const debit = Math.ceil(totalUsd / rate);
    const subtotalMinor = Math.ceil(totalUsd * 100);
    if (!Number.isSafeInteger(debit) || debit <= 0 || !Number.isSafeInteger(subtotalMinor) || subtotalMinor <= 0) {
      return { kind: "unavailable" as const, code: "MANAGED_CREDIT_QUOTE_INVALID" };
    }
    const pricingSnapshotDigest = canonicalDigest({ schema: "managed-generation-credit-price/v1", usdPerCredit: rate, providerQuote: input.quote }) as `sha256:${string}`;
    try {
      const quote = await this.commercial.issueQuote({ workspaceId: input.workspaceId, purposeRef: `generation:${input.intentId}`, maxCreditDebit: debit, pricingSnapshotDigest, expiresAt: input.quote.expiresAt, localPriceMinor: subtotalMinor, currency: "USD", taxMinor: 0, idempotencyKey: `generation:${input.intentId}:commercial-quote` });
      const quoteId = field(quote, "id");
      if (typeof quoteId !== "string") throw new Error("MANAGED_QUOTE_RECEIPT_INVALID");
      const offer = quoteOffer({ workspaceId: input.workspaceId, intentId: input.intentId, quoteId, totalDebitUnits: debit, subtotalMinor, expiresAt: input.quote.expiresAt, pricingSnapshotDigest });
      if (!input.managedQuoteAcceptance) return { kind: "confirmation_required" as const, quote: offer };
      if (input.managedQuoteAcceptance.quoteId !== offer.quoteId || input.managedQuoteAcceptance.confirmationDigest !== offer.confirmationDigest) {
        return { kind: "denied" as const, code: "MANAGED_CREDIT_CONFIRMATION_INVALID" };
      }
      const runtime = await this.runtime.reserve(input);
      if (runtime.kind !== "reserved") return runtime;
      await this.commercial.acceptQuote({ workspaceId: input.workspaceId, userId: input.principalId, quoteId, idempotencyKey: `generation:${input.intentId}:commercial-accept` });
      const reservation = await this.commercial.reserveQuote({ workspaceId: input.workspaceId, quoteId, externalEffectRef: `generation:${input.intentId}`, idempotencyKey: `generation:${input.intentId}:commercial-reserve` });
      const reservationId = field(reservation, "reservationId");
      if (typeof reservationId !== "string") throw new Error("MANAGED_RESERVATION_RECEIPT_INVALID");
      return { kind: "reserved" as const, reservationIds: [...runtime.reservationIds, `generation-credit:${reservationId}`], disposition: runtime.disposition };
    } catch {
      await this.runtime.release(input).catch(() => undefined);
      return { kind: "denied" as const, code: "MANAGED_CREDIT_RESERVATION_DENIED" };
    }
  }

  async release(input: Parameters<GenerationBudgetAuthority["release"]>[0]) {
    await this.runtime.release(input);
    try {
      await this.commercial.settleGenerationEffect({ workspaceId: input.workspaceId, intentId: input.intentId, outcome: "pre_start_cancelled" });
    } catch {
      // A held credit reservation remains recoverable and is safer than hiding
      // the primary admission failure behind a secondary settlement outage.
    }
  }
}
