import { describe, expect, it } from "vitest";
import { financialStateFromAdjustments } from "../financial-evidence";

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
