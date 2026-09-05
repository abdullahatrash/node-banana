import { describe, expect, it } from "vitest";
import { readCommercialSummary } from "../summary";

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
