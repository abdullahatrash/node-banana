import { describe, expect, it, vi } from "vitest";

import type { GenerationBudgetAuthority } from "../budget-authority";
import { ManagedGenerationBudgetAuthority } from "../managed-budget-authority";
import { testRef } from "./fixtures";

const at = new Date("2026-09-04T00:00:00.000Z");
const quote = { currency: "USD" as const, amount: 0.05, basis: "second" as const, quantity: 8, quotedAt: at, expiresAt: new Date(at.getTime() + 300_000) };

function runtime(kind: "reserved" | "denied" = "reserved") {
  const reserve = vi.fn<GenerationBudgetAuthority["reserve"]>().mockResolvedValue(kind === "reserved"
    ? { kind: "reserved", reservationIds: ["runtime"], disposition: "created" }
    : { kind: "denied", code: "BUDGET_LIMIT_EXCEEDED" });
  const release = vi.fn<GenerationBudgetAuthority["release"]>().mockResolvedValue(undefined);
  return { authority: { reserve, release } satisfies GenerationBudgetAuthority, reserve, release };
}

function commercial() {
  return {
    issueQuote: vi.fn().mockResolvedValue({ id: "quote-1" }),
    acceptQuote: vi.fn().mockResolvedValue({ quoteId: "quote-1", state: "accepted" }),
    reserveQuote: vi.fn().mockResolvedValue({ reservationId: "credits-1" }),
    settleGenerationEffect: vi.fn().mockResolvedValue(null),
  };
}

const input = { workspaceId: "ws", principalId: "user", intentId: "intent", model: testRef(5), quote, fundingMode: "managed" as const, at };

describe("ManagedGenerationBudgetAuthority", () => {
  it("leaves BYOK execution on the Workspace USD budget lane", async () => {
    const rt = runtime(); const credits = commercial();
    const authority = new ManagedGenerationBudgetAuthority(rt.authority, credits, { MANAGED_GENERATION_USD_PER_CREDIT: "0.01" });
    await expect(authority.reserve({ ...input, fundingMode: "byok" })).resolves.toEqual({ kind: "reserved", reservationIds: ["runtime"], disposition: "created" });
    expect(credits.issueQuote).not.toHaveBeenCalled();
  });

  it("pins a server-priced fixed quote and reserves plan, purchased, or referral credits", async () => {
    const rt = runtime(); const credits = commercial();
    const authority = new ManagedGenerationBudgetAuthority(rt.authority, credits, { MANAGED_GENERATION_USD_PER_CREDIT: "0.03" });
    const offered = await authority.reserve(input);
    expect(offered).toMatchObject({ kind: "confirmation_required", quote: { quoteId: "quote-1", intentId: "intent", totalDebitUnits: 14, currency: "USD", subtotalMinor: 40, taxMinor: 0, totalMinor: 40, expiresAt: quote.expiresAt.toISOString() } });
    expect(rt.reserve).not.toHaveBeenCalled(); expect(credits.acceptQuote).not.toHaveBeenCalled(); expect(credits.reserveQuote).not.toHaveBeenCalled();
    if (offered.kind !== "confirmation_required") throw new Error("expected quote");
    await expect(authority.reserve({ ...input, managedQuoteAcceptance: { quoteId: offered.quote.quoteId, confirmationDigest: offered.quote.confirmationDigest } })).resolves.toEqual({ kind: "reserved", reservationIds: ["runtime", "generation-credit:credits-1"], disposition: "created" });
    expect(credits.issueQuote).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: "ws", purposeRef: "generation:intent", maxCreditDebit: 14, idempotencyKey: "generation:intent:commercial-quote" }));
    expect(credits.reserveQuote).toHaveBeenCalledWith(expect.objectContaining({ externalEffectRef: "generation:intent", idempotencyKey: "generation:intent:commercial-reserve" }));
  });

  it("rejects a quote confirmation that is not bound to the exact admission facts", async () => {
    const rt = runtime(); const credits = commercial();
    const authority = new ManagedGenerationBudgetAuthority(rt.authority, credits, { MANAGED_GENERATION_USD_PER_CREDIT: "0.03" });
    await expect(authority.reserve({ ...input, managedQuoteAcceptance: { quoteId: "quote-1", confirmationDigest: `sha256:${"0".repeat(64)}` } })).resolves.toEqual({ kind: "denied", code: "MANAGED_CREDIT_CONFIRMATION_INVALID" });
    expect(rt.reserve).not.toHaveBeenCalled(); expect(credits.acceptQuote).not.toHaveBeenCalled();
  });

  it("releases the USD reservation if managed pricing or credits cannot be reserved", async () => {
    const rt = runtime(); const credits = commercial(); credits.reserveQuote.mockRejectedValue(new Error("INSUFFICIENT_CREDITS"));
    const authority = new ManagedGenerationBudgetAuthority(rt.authority, credits, { MANAGED_GENERATION_USD_PER_CREDIT: "0.01" });
    const offered = await authority.reserve(input); if (offered.kind !== "confirmation_required") throw new Error("expected quote");
    const acceptedInput = { ...input, managedQuoteAcceptance: { quoteId: offered.quote.quoteId, confirmationDigest: offered.quote.confirmationDigest } };
    await expect(authority.reserve(acceptedInput)).resolves.toEqual({ kind: "denied", code: "MANAGED_CREDIT_RESERVATION_DENIED" });
    expect(rt.release).toHaveBeenCalledWith(acceptedInput);
  });

  it("fails closed before credit reservation for unsupported managed providers", async () => {
    const rt = runtime(); const credits = commercial();
    const authority = new ManagedGenerationBudgetAuthority(rt.authority, credits, { MANAGED_GENERATION_USD_PER_CREDIT: "0.01" });
    await expect(authority.reserve({ ...input, model: { ...input.model, provider: "google" } })).resolves.toEqual({ kind: "unavailable", code: "MANAGED_PROVIDER_UNAVAILABLE" });
    expect(rt.release).not.toHaveBeenCalled();
    expect(credits.issueQuote).not.toHaveBeenCalled();
  });
});
