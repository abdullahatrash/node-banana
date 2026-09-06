import { describe, expect, it } from "vitest";
import { projectCommercialStatusSummary, readCommercialSummary } from "../summary";

const summary = {
  subscription: null,
  plans: [],
  creditPacks: [],
  quotes: [],
  credit: { availableUnits: 0, liabilityUnits: 0, buckets: [], heldReservations: [], recentEntries: [] },
  financials: {
    transactions: [],
    adjustments: [],
    executionHolds: [{
      provider: "paddle",
      transactionRef: "txn_1",
      merchantSubscriptionRef: "sub_1",
      reason: "disputed",
      state: "active",
      periodStartsAt: "2026-09-01T00:00:00.000Z",
      periodEndsAt: "2026-10-01T00:00:00.000Z",
    }],
  },
  referrals: { codes: [], rewards: [], payoutEntries: [] },
};

describe("readCommercialSummary", () => {
  it("accepts workspace-scoped subscription-period execution holds", () => {
    expect(readCommercialSummary(summary)?.financials.executionHolds).toEqual(summary.financials.executionHolds);
  });

  it("fails closed when financial hold evidence is missing", () => {
    const { executionHolds: _executionHolds, ...financials } = summary.financials;
    expect(readCommercialSummary({ ...summary, financials })).toBeNull();
  });
});

describe("projectCommercialStatusSummary", () => {
  it("keeps only the shell plan and balance fields", () => {
    const commercialSummary = {
      ...summary,
      subscription: {
        state: "trialing",
        planId: "starter",
        planVersion: 1,
        authoredName: { ar: "البداية", en: "Starter" },
        entitlements: { managedGeneration: true },
        currentPeriodEndsAt: "2026-09-11T00:00:00.000Z",
        graceEndsAt: null,
        merchantCustomerRef: null,
        merchantSubscriptionRef: null,
      },
      plans: [{
        planId: "starter",
        version: 1,
        authoredName: { ar: "البداية", en: "Starter" },
        currency: "USD",
        priceMinor: 2_900,
        billingInterval: "month",
        trialDays: 7,
        trialCreditUnits: 25,
        entitlements: { managedGeneration: true },
      }],
      credit: { ...summary.credit, availableUnits: 25 },
    };

    expect(projectCommercialStatusSummary(commercialSummary)).toEqual({
      subscription: {
        state: "trialing",
        planId: "starter",
        currentPeriodEndsAt: "2026-09-11T00:00:00.000Z",
      },
      plans: [{ planId: "starter", authoredName: { ar: "البداية", en: "Starter" } }],
      credit: { availableUnits: 25 },
    });
  });
});
