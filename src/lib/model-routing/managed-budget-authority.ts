import { canonicalDigest } from "@/lib/agent-tools/canonical";
import type { CommercialRepository } from "@/lib/commercial/repository";
import type { GenerationBudgetAuthority } from "./budget-authority";

type ManagedCommercialPort = Pick<CommercialRepository, "issueQuote" | "acceptQuote" | "reserveQuote" | "settleGenerationEffect">;

type ManagedGenerationEnvironment = Readonly<Record<string, string | undefined>>;

function creditRate(environment: ManagedGenerationEnvironment): number | null {
  const value = Number(environment.MANAGED_GENERATION_USD_PER_CREDIT);
  return Number.isFinite(value) && value > 0 && value <= 100 ? value : null;
}

function field(value: unknown, key: string): unknown {
  return value && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined;
}

/** Applies the Workspace USD ceiling to both lanes, then adds a fixed credit reservation for managed execution. */
export class ManagedGenerationBudgetAuthority implements GenerationBudgetAuthority {
  constructor(
    private readonly runtime: GenerationBudgetAuthority,
    private readonly commercial: ManagedCommercialPort,
    private readonly environment: ManagedGenerationEnvironment = process.env,
  ) {}

  async reserve(input: Parameters<GenerationBudgetAuthority["reserve"]>[0]) {
    const runtime = await this.runtime.reserve(input);
    if (runtime.kind !== "reserved" || (input.fundingMode ?? "byok") === "byok") return runtime;
    if (input.model.provider !== "replicate") {
      await this.runtime.release(input);
      return { kind: "unavailable" as const, code: "MANAGED_PROVIDER_UNAVAILABLE" };
    }
    const rate = creditRate(this.environment);
    if (!rate) {
      await this.runtime.release(input);
      return { kind: "unavailable" as const, code: "MANAGED_CREDIT_PRICING_UNAVAILABLE" };
    }
    const debit = Math.ceil((input.quote.amount * input.quote.quantity) / rate);
    if (!Number.isSafeInteger(debit) || debit <= 0) {
      await this.runtime.release(input);
      return { kind: "unavailable" as const, code: "MANAGED_CREDIT_QUOTE_INVALID" };
    }
    try {
      const quote = await this.commercial.issueQuote({ workspaceId: input.workspaceId, purposeRef: `generation:${input.intentId}`, maxCreditDebit: debit, pricingSnapshotDigest: canonicalDigest({ schema: "managed-generation-credit-price/v1", usdPerCredit: rate, providerQuote: input.quote }), expiresAt: input.quote.expiresAt, localPriceMinor: null, currency: null, taxMinor: null, idempotencyKey: `generation:${input.intentId}:commercial-quote` });
      const quoteId = field(quote, "id");
      if (typeof quoteId !== "string") throw new Error("MANAGED_QUOTE_RECEIPT_INVALID");
      await this.commercial.acceptQuote({ workspaceId: input.workspaceId, userId: input.principalId, quoteId, idempotencyKey: `generation:${input.intentId}:commercial-accept` });
      const reservation = await this.commercial.reserveQuote({ workspaceId: input.workspaceId, quoteId, externalEffectRef: `generation:${input.intentId}`, idempotencyKey: `generation:${input.intentId}:commercial-reserve` });
      const reservationId = field(reservation, "reservationId");
      if (typeof reservationId !== "string") throw new Error("MANAGED_RESERVATION_RECEIPT_INVALID");
      return { kind: "reserved" as const, reservationIds: [...runtime.reservationIds, `generation-credit:${reservationId}`], disposition: runtime.disposition };
    } catch {
      await this.runtime.release(input);
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
