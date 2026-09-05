import { describe, expect, it } from "vitest";
import { canTransitionReferralPayout } from "../referral-payout-state";

describe("referral payout transitions", () => {
  it("accepts conclusive cancellation from every non-terminal provider state", () => {
    for (const state of [
      "submitted",
      "processing",
      "action_required",
      "outcome_unknown",
    ] as const) {
      expect(canTransitionReferralPayout(state, "cancelled")).toBe(true);
    }
  });

  it("keeps paid, known-failed, and cancelled requests terminal", () => {
    for (const state of ["paid", "failed_known", "cancelled"] as const) {
      expect(canTransitionReferralPayout(state, "processing")).toBe(false);
      expect(canTransitionReferralPayout(state, "cancelled")).toBe(false);
    }
  });
});
