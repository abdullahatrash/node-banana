import { describe, expect, it, vi } from "vitest";
import { ReferralPayoutDispatchService, referralPayoutDispatchDelayMs, type ReferralPayoutDispatchClaim, type ReferralPayoutDispatchStore } from "../referral-payout-dispatch";
import type { ReferralPayoutProvider, ReferralPayoutProviderOutcome, ReferralPayoutProviderResult } from "../referral-payout-provider";

const NOW = new Date("2026-09-05T12:00:00.000Z");
const claim: ReferralPayoutDispatchClaim = {
  workspaceId: "workspace-1",
  payoutRequestId: "payout-1",
  providerIdempotencyKey: "referral-payout:workspace-1:payout-1",
  payoutProvider: "provider.test",
  providerRecipientRef: "recipient-opaque-1",
  amountMinor: 12_500,
  currency: "USD",
  requestEvidenceDigest: `sha256:${"a".repeat(64)}`,
  state: "submitted",
  attempt: 1,
  maxAttempts: 12,
  leaseOwner: "worker-1",
};

function outcome(state: ReferralPayoutProviderOutcome["state"]): ReferralPayoutProviderOutcome {
  return {
    state,
    providerEventRef: `event-${state}`,
    merchantPayoutRef: state === "paid" ? "merchant-payout-1" : null,
    evidenceDigest: `sha256:${"b".repeat(64)}`,
    occurredAt: NOW,
  };
}

function harness(input: {
  claims?: ReferralPayoutDispatchClaim[];
  configured?: boolean;
  lookup?: ReferralPayoutProviderResult;
  submit?: ReferralPayoutProviderResult;
} = {}) {
  const store: ReferralPayoutDispatchStore = {
    claimDue: vi.fn().mockResolvedValue(input.claims ?? [claim]),
    applyOutcome: vi.fn().mockResolvedValue(undefined),
    release: vi.fn().mockResolvedValue(undefined),
  };
  const provider: ReferralPayoutProvider = {
    isConfigured: vi.fn().mockReturnValue(input.configured ?? true),
    lookup: vi.fn().mockResolvedValue(input.lookup ?? { kind: "not_found" }),
    submit: vi.fn().mockResolvedValue(input.submit ?? { kind: "outcome", outcome: outcome("processing") }),
  };
  return { store, provider, service: new ReferralPayoutDispatchService(store, provider, () => NOW) };
}

describe("ReferralPayoutDispatchService", () => {
  it("does not claim requests when the provider gateway is unavailable", async () => {
    const { service, store } = harness({ configured: false });
    await expect(service.reconcile()).resolves.toMatchObject({ inspected: 0, unavailable: 1 });
    expect(store.claimDue).not.toHaveBeenCalled();
  });

  it("looks up the stable key before the first submission", async () => {
    const { service, store, provider } = harness();
    await expect(service.reconcile()).resolves.toMatchObject({ inspected: 1, submitted: 1, pending: 1 });
    expect(provider.lookup).toHaveBeenCalledWith(claim);
    expect(provider.submit).toHaveBeenCalledWith(claim);
    expect(vi.mocked(provider.lookup).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(provider.submit).mock.invocationCallOrder[0]!);
    expect(store.applyOutcome).toHaveBeenCalledWith(claim, outcome("processing"));
  });

  it("reconciles an existing provider record without submitting again", async () => {
    const paid = outcome("paid");
    const { service, provider, store } = harness({ lookup: { kind: "outcome", outcome: paid } });
    await expect(service.reconcile()).resolves.toMatchObject({ reconciled: 1, paid: 1, submitted: 0 });
    expect(provider.submit).not.toHaveBeenCalled();
    expect(store.applyOutcome).toHaveBeenCalledWith(claim, paid);
  });

  it("never resubmits a missing provider record from an ambiguous state", async () => {
    const ambiguous = { ...claim, state: "outcome_unknown" as const, attempt: 4 };
    const { service, provider, store } = harness({ claims: [ambiguous] });
    await expect(service.reconcile()).resolves.toMatchObject({ submitted: 0, retryScheduled: 1 });
    expect(provider.submit).not.toHaveBeenCalled();
    expect(store.release).toHaveBeenCalledWith(ambiguous, expect.objectContaining({ errorCode: "REFERRAL_PAYOUT_PROVIDER_RECORD_NOT_FOUND" }));
  });

  it.each(["processing", "outcome_unknown"] as const)(
    "records a conclusive cancellation while reconciling %s",
    async (state) => {
      const reconciling = { ...claim, state, attempt: 4 };
      const cancelled = outcome("cancelled");
      const { service, provider, store } = harness({
        claims: [reconciling],
        lookup: { kind: "outcome", outcome: cancelled },
      });

      await expect(service.reconcile()).resolves.toMatchObject({
        reconciled: 1,
        failedKnown: 1,
        submitted: 0,
      });
      expect(provider.submit).not.toHaveBeenCalled();
      expect(store.applyOutcome).toHaveBeenCalledWith(reconciling, cancelled);
    },
  );

  it("turns exhausted uncertainty into an explicit outcome_unknown event", async () => {
    const exhausted = { ...claim, state: "processing" as const, attempt: 12, maxAttempts: 12 };
    const { service, store } = harness({ claims: [exhausted], lookup: { kind: "retryable", code: "REFERRAL_PAYOUT_GATEWAY_TIMEOUT" } });
    await expect(service.reconcile()).resolves.toMatchObject({ outcomeUnknown: 1, retryScheduled: 0 });
    expect(store.applyOutcome).toHaveBeenCalledWith(exhausted, expect.objectContaining({ state: "outcome_unknown", merchantPayoutRef: null }));
    expect(store.applyOutcome).toHaveBeenCalledWith(exhausted, expect.objectContaining({ occurredAt: NOW }));
  });

  it("requires the pinned verified recipient reference before any provider request", async () => {
    const invalid = { ...claim, providerRecipientRef: "" };
    const { service, provider, store } = harness({ claims: [invalid] });
    await expect(service.reconcile()).resolves.toMatchObject({ actionRequired: 1, submitted: 0 });
    expect(provider.lookup).not.toHaveBeenCalled();
    expect(provider.submit).not.toHaveBeenCalled();
    expect(store.applyOutcome).toHaveBeenCalledWith(invalid, expect.objectContaining({ state: "action_required" }));
  });
});

describe("referralPayoutDispatchDelayMs", () => {
  it("backs off by state and caps at fifteen minutes", () => {
    expect(referralPayoutDispatchDelayMs(1, "processing")).toBe(15_000);
    expect(referralPayoutDispatchDelayMs(2, "outcome_unknown")).toBe(120_000);
    expect(referralPayoutDispatchDelayMs(99, "outcome_unknown")).toBe(900_000);
  });
});
