import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConfiguredReferralPayoutProvider, type ReferralPayoutProviderInput } from "../referral-payout-provider";

const input: ReferralPayoutProviderInput = {
  payoutRequestId: "payout_1",
  providerIdempotencyKey: "referral-payout:workspace-1:payout_1",
  payoutProvider: "provider.test",
  providerRecipientRef: "recipient_opaque_1",
  amountMinor: 12_500,
  currency: "USD",
  requestEvidenceDigest: `sha256:${"a".repeat(64)}`,
};
const environment = {
  REFERRAL_PAYOUT_GATEWAY_URL: "https://payout-gateway.example.test/commands",
  REFERRAL_PAYOUT_GATEWAY_TOKEN: "gateway-secret",
  REFERRAL_PAYOUT_PROVIDER_NAME: "provider.test",
};

describe("ConfiguredReferralPayoutProvider", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("fails closed for missing, placeholder, and unsafe configuration", async () => {
    const fetcher = vi.fn<typeof fetch>();
    expect(new ConfiguredReferralPayoutProvider({}, fetcher).isConfigured()).toBe(false);
    expect(new ConfiguredReferralPayoutProvider({ ...environment, REFERRAL_PAYOUT_GATEWAY_TOKEN: "change-me" }, fetcher).isConfigured()).toBe(false);
    expect(new ConfiguredReferralPayoutProvider({ ...environment, REFERRAL_PAYOUT_GATEWAY_URL: "http://payout.example.test/commands" }, fetcher).isConfigured()).toBe(false);
    await expect(new ConfiguredReferralPayoutProvider({}, fetcher).lookup(input)).resolves.toEqual({ kind: "unavailable", code: "REFERRAL_PAYOUT_GATEWAY_NOT_CONFIGURED" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("sends only opaque recipient and immutable commercial identity", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      schema: "referral-payout-gateway/v1",
      kind: "not_found",
      provider: "provider.test",
      idempotencyKey: input.providerIdempotencyKey,
      payoutRequestId: input.payoutRequestId,
      amountMinor: input.amountMinor,
      currency: input.currency,
      requestEvidenceDigest: input.requestEvidenceDigest,
    }), { status: 200 }));
    await expect(new ConfiguredReferralPayoutProvider(environment, fetcher).lookup(input)).resolves.toEqual({ kind: "not_found" });
    const [url, init] = fetcher.mock.calls[0]!;
    expect(String(url)).toBe(environment.REFERRAL_PAYOUT_GATEWAY_URL);
    expect(init).toMatchObject({ method: "POST", redirect: "error", headers: { authorization: "Bearer gateway-secret" } });
    const body = JSON.parse(String(init?.body));
    expect(body).toEqual({
      schema: "referral-payout-command/v1",
      action: "lookup",
      provider: "provider.test",
      idempotencyKey: input.providerIdempotencyKey,
      payoutRequestId: input.payoutRequestId,
      providerRecipientRef: input.providerRecipientRef,
      amountMinor: input.amountMinor,
      currency: input.currency,
      requestEvidenceDigest: input.requestEvidenceDigest,
    });
    expect(JSON.stringify(body)).not.toMatch(/bank|iban|routing|account_number|tax_evidence/i);
  });

  it("hydrates a verified provider outcome", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      schema: "referral-payout-gateway/v1",
      kind: "outcome",
      provider: "provider.test",
      idempotencyKey: input.providerIdempotencyKey,
      payoutRequestId: input.payoutRequestId,
      amountMinor: input.amountMinor,
      currency: input.currency,
      requestEvidenceDigest: input.requestEvidenceDigest,
      outcome: {
        state: "paid",
        providerEventRef: "event_1",
        merchantPayoutRef: "payout_provider_1",
        evidenceDigest: `sha256:${"b".repeat(64)}`,
        occurredAt: "2026-09-05T10:00:00.000Z",
      },
    }), { status: 200 }));
    await expect(new ConfiguredReferralPayoutProvider(environment, fetcher).submit(input)).resolves.toMatchObject({
      kind: "outcome",
      outcome: { state: "paid", providerEventRef: "provider.test:event_1", merchantPayoutRef: "provider.test:payout_provider_1", occurredAt: new Date("2026-09-05T10:00:00.000Z") },
    });
  });

  it("keeps lookup failures retryable but makes ambiguous submission outcome unknown", async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(Object.assign(new Error("aborted"), { name: "AbortError" }));
    const provider = new ConfiguredReferralPayoutProvider(environment, fetcher);
    await expect(provider.lookup(input)).resolves.toEqual({ kind: "retryable", code: "REFERRAL_PAYOUT_GATEWAY_TIMEOUT" });
    await expect(provider.submit(input)).resolves.toMatchObject({ kind: "outcome", outcome: { state: "outcome_unknown", merchantPayoutRef: null } });
  });

  it("rejects a paid response without the provider payout reference", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      schema: "referral-payout-gateway/v1", kind: "outcome", provider: "provider.test", idempotencyKey: input.providerIdempotencyKey, payoutRequestId: input.payoutRequestId, amountMinor: input.amountMinor, currency: input.currency, requestEvidenceDigest: input.requestEvidenceDigest,
      outcome: { state: "paid", providerEventRef: "event_1", merchantPayoutRef: null, evidenceDigest: `sha256:${"b".repeat(64)}`, occurredAt: "2026-09-05T10:00:00.000Z" },
    }), { status: 200 }));
    await expect(new ConfiguredReferralPayoutProvider(environment, fetcher).submit(input)).resolves.toMatchObject({ kind: "outcome", outcome: { state: "outcome_unknown" } });
  });
});
