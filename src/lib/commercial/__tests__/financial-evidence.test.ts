import { describe, expect, it } from "vitest";
import { creditClawbackTarget, creditPackClawbackTarget, financialStateFromAdjustments, reconcileCreditClawback, reconcileReleasedCredits, subscriptionFinancialHoldState } from "../financial-evidence";

const at = (day: number) => new Date(`2026-09-${String(day).padStart(2, "0")}T00:00:00.000Z`);

describe("financialStateFromAdjustments", () => {
  it("projects approved partial and full refunds while ignoring pending approval", () => {
    expect(financialStateFromAdjustments(1_000, [{ action: "refund", status: "pending_approval", amountMinor: 400, providerOccurredAt: at(1) }])).toEqual({ refundedMinor: 0, status: "completed" });
    expect(financialStateFromAdjustments(1_000, [{ action: "refund", status: "approved", amountMinor: 400, providerOccurredAt: at(1) }])).toEqual({ refundedMinor: 400, status: "partially_refunded" });
    expect(financialStateFromAdjustments(1_000, [{ action: "refund", status: "approved", amountMinor: 1_000, providerOccurredAt: at(1) }])).toEqual({ refundedMinor: 1_000, status: "refunded" });
  });

  it("lets an approved credit reversal reduce the projected refund", () => {
    expect(financialStateFromAdjustments(1_000, [
      { action: "credit", status: "approved", amountMinor: 600, providerOccurredAt: at(1) },
      { action: "credit_reverse", status: "approved", amountMinor: 600, providerOccurredAt: at(2) },
    ])).toEqual({ refundedMinor: 0, status: "completed" });
  });

  it("uses the newest approved chargeback fact for dispute state", () => {
    expect(financialStateFromAdjustments(1_000, [
      { action: "chargeback", status: "approved", amountMinor: 1_000, providerOccurredAt: at(1) },
      { action: "chargeback_reverse", status: "approved", amountMinor: 1_000, providerOccurredAt: at(2) },
    ])).toEqual({ refundedMinor: 0, status: "chargeback_reversed" });
  });

  it("rejects aggregate approved refunds larger than the original transaction", () => {
    expect(() => financialStateFromAdjustments(1_000, [
      { action: "refund", status: "approved", amountMinor: 700, providerOccurredAt: at(1) },
      { action: "credit", status: "approved", amountMinor: 500, providerOccurredAt: at(2) },
    ])).toThrow("ADJUSTMENT_TOTAL_EXCEEDS_TRANSACTION");
  });
});

describe("creditPackClawbackTarget", () => {
  it("revokes credits proportionally and exactly on a full refund", () => {
    expect(creditPackClawbackTarget({ grantedUnits: 100, amountMinor: 1_000, refundedMinor: 250, transactionStatus: "partially_refunded" })).toBe(25);
    expect(creditPackClawbackTarget({ grantedUnits: 100, amountMinor: 1_000, refundedMinor: 1_000, transactionStatus: "refunded" })).toBe(100);
  });

  it("holds the full pack during a dispute and restores the monetary target after reversal", () => {
    expect(creditPackClawbackTarget({ grantedUnits: 100, amountMinor: 1_000, refundedMinor: 0, transactionStatus: "disputed" })).toBe(100);
    expect(creditPackClawbackTarget({ grantedUnits: 100, amountMinor: 1_000, refundedMinor: 0, transactionStatus: "chargeback_reversed" })).toBe(0);
  });

  it("rejects unsafe or impossible monetary ratios", () => {
    expect(() => creditPackClawbackTarget({ grantedUnits: 100, amountMinor: 0, refundedMinor: 0, transactionStatus: "completed" })).toThrow("CREDIT_CLAWBACK_INPUT_INVALID");
    expect(() => creditPackClawbackTarget({ grantedUnits: 100, amountMinor: 1_000, refundedMinor: 1_001, transactionStatus: "refunded" })).toThrow("CREDIT_CLAWBACK_INPUT_INVALID");
  });
});

describe("creditClawbackTarget", () => {
  it("uses the same exact proportional rule for a subscription allowance", () => {
    expect(creditClawbackTarget({ grantedUnits: 150, amountMinor: 2_900, refundedMinor: 1_450, transactionStatus: "partially_refunded" })).toBe(75);
    expect(creditClawbackTarget({ grantedUnits: 150, amountMinor: 2_900, refundedMinor: 2_900, transactionStatus: "refunded" })).toBe(150);
  });

  it("targets the full allowance while its subscription charge is disputed", () => {
    expect(creditClawbackTarget({ grantedUnits: 150, amountMinor: 2_900, refundedMinor: 0, transactionStatus: "disputed" })).toBe(150);
    expect(creditClawbackTarget({ grantedUnits: 150, amountMinor: 2_900, refundedMinor: 0, transactionStatus: "chargeback_reversed" })).toBe(0);
  });
});

describe("subscriptionFinancialHoldState", () => {
  it.each([
    [{ amountMinor: 2_900, refundedMinor: 0, transactionStatus: "disputed" }, "active"],
    [{ amountMinor: 2_900, refundedMinor: 2_900, transactionStatus: "refunded" }, "active"],
  ] as const)("activates for a disputed or fully refunded paid period", (input, expected) => {
    expect(subscriptionFinancialHoldState(input)).toBe(expected);
  });

  it.each([
    [{ amountMinor: 2_900, refundedMinor: 1_450, transactionStatus: "partially_refunded" }, "released"],
    [{ amountMinor: 2_900, refundedMinor: 0, transactionStatus: "completed" }, "released"],
    [{ amountMinor: 2_900, refundedMinor: 0, transactionStatus: "chargeback_reversed" }, "released"],
  ] as const)("does not hold a partially refunded, paid, or reversed period", (input, expected) => {
    expect(subscriptionFinancialHoldState(input)).toBe(expected);
  });

  it("rejects invalid monetary evidence instead of accidentally releasing access", () => {
    expect(() => subscriptionFinancialHoldState({ amountMinor: 0, refundedMinor: 0, transactionStatus: "completed" })).toThrow("SUBSCRIPTION_FINANCIAL_HOLD_INPUT_INVALID");
    expect(() => subscriptionFinancialHoldState({ amountMinor: 2_900, refundedMinor: 2_901, transactionStatus: "refunded" })).toThrow("SUBSCRIPTION_FINANCIAL_HOLD_INPUT_INVALID");
  });
});

describe("reconcileCreditClawback", () => {
  it("removes available credits first and records already-consumed units as outstanding", () => {
    expect(reconcileCreditClawback({ previousTarget: 0, target: 100, appliedUnits: 0, outstandingUnits: 0, availableUnits: 60, grantedUnits: 100 })).toEqual({ appliedUnits: 60, outstandingUnits: 40, availableUnits: 0, ledgerDelta: -60 });
  });

  it("clears outstanding units before restoring credits after a reversal", () => {
    expect(reconcileCreditClawback({ previousTarget: 100, target: 50, appliedUnits: 60, outstandingUnits: 40, availableUnits: 0, grantedUnits: 100 })).toEqual({ appliedUnits: 50, outstandingUnits: 0, availableUnits: 10, ledgerDelta: 10 });
  });

  it("rejects a liability projection that does not balance", () => {
    expect(() => reconcileCreditClawback({ previousTarget: 50, target: 50, appliedUnits: 10, outstandingUnits: 10, availableUnits: 50, grantedUnits: 100 })).toThrow("CREDIT_CLAWBACK_INVARIANT_FAILED");
  });
});

describe("reconcileReleasedCredits", () => {
  it("uses a released in-flight reservation to clear the matching liability", () => {
    expect(reconcileReleasedCredits({ releasedUnits: 40, appliedUnits: 60, outstandingUnits: 40, availableUnits: 0, grantedUnits: 100, targetUnits: 100 })).toEqual({ releasedBalanceUnits: 40, availableUnits: 0, clawbackUnits: 40, appliedUnits: 100, outstandingUnits: 0 });
  });

  it("returns only the release amount beyond the outstanding liability", () => {
    expect(reconcileReleasedCredits({ releasedUnits: 40, appliedUnits: 80, outstandingUnits: 20, availableUnits: 0, grantedUnits: 100, targetUnits: 100 })).toEqual({ releasedBalanceUnits: 40, availableUnits: 20, clawbackUnits: 20, appliedUnits: 100, outstandingUnits: 0 });
  });
});
