import { describe, expect, it } from "vitest";
import { merchantAdjustmentFailureState, merchantAdjustmentRetryDelayMs } from "../adjustment-inbox";

describe("merchant adjustment recovery policy", () => {
  it("retries missing financial prerequisites as an out-of-order dependency", () => {
    for (const code of [
      "ADJUSTMENT_TRANSACTION_NOT_READY",
      "ADJUSTMENT_CREDIT_BUCKET_NOT_READY",
      "ADJUSTMENT_SUBSCRIPTION_PERIOD_NOT_READY",
    ]) {
      expect(merchantAdjustmentFailureState({ code, attempt: 1, maxAttempts: 12 })).toBe("pending_dependency");
    }
    expect(merchantAdjustmentFailureState({ code: "ADJUSTMENT_TRANSACTION_NOT_READY", attempt: 12, maxAttempts: 12 })).toBe("failed_known");
  });

  it("does not retry deterministic conflicts or invalid financial evidence", () => {
    for (const code of [
      "ADJUSTMENT_TRANSACTION_MISMATCH",
      "ADJUSTMENT_WEBHOOK_REPLAY_CONFLICT",
      "ADJUSTMENT_TOTAL_EXCEEDS_TRANSACTION",
      "CREDIT_CLAWBACK_INPUT_INVALID",
      "CREDIT_CLAWBACK_INVARIANT_FAILED",
      "SUBSCRIPTION_FINANCIAL_HOLD_INPUT_INVALID",
    ]) {
      expect(merchantAdjustmentFailureState({ code, attempt: 1, maxAttempts: 12 })).toBe("failed_known");
    }
  });

  it("retries an unexpected internal failure, then makes an exhausted ambiguity explicit", () => {
    expect(merchantAdjustmentFailureState({ code: "DATABASE_CONNECTION_LOST", attempt: 1, maxAttempts: 12 })).toBe("received");
    expect(merchantAdjustmentFailureState({ code: "DATABASE_CONNECTION_LOST", attempt: 12, maxAttempts: 12 })).toBe("outcome_unknown");
  });

  it("uses bounded exponential backoff without letting one dependency monopolize recovery", () => {
    expect(merchantAdjustmentRetryDelayMs(0, "pending_dependency")).toBe(15_000);
    expect(merchantAdjustmentRetryDelayMs(1, "pending_dependency")).toBe(30_000);
    expect(merchantAdjustmentRetryDelayMs(0, "error")).toBe(60_000);
    expect(merchantAdjustmentRetryDelayMs(2, "error")).toBe(240_000);
    expect(merchantAdjustmentRetryDelayMs(100, "error")).toBe(900_000);
  });
});
