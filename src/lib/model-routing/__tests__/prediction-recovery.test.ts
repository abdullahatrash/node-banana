import { describe, expect, it } from "vitest";
import { recoveryDisposition } from "../prediction-recovery";

describe("Replicate recovery disposition", () => {
  it("keeps async work held while polling and settles only known-cost success", () => {
    expect(recoveryDisposition({ state: "waiting_provider", predictionId: "p" })).toEqual({ operationState: "waiting_provider", effectState: "submitted", budgetState: "held" });
    expect(recoveryDisposition({ state: "succeeded", predictionId: "p", artifactIds: ["a"], textOutputIds: [] })).toEqual({ operationState: "succeeded", effectState: "succeeded", budgetState: "settled" });
    expect(recoveryDisposition({ state: "failed_known", predictionId: "p", code: "FAILED" }).budgetState).toBe("outcome_unknown");
  });
  it("does not release ambiguous or post-start cancelled spend before cost reconciliation", () => {
    expect(recoveryDisposition({ state: "outcome_unknown", predictionId: "p", code: "LOST" }).budgetState).toBe("outcome_unknown");
    expect(recoveryDisposition({ state: "cancelled", predictionId: "p" }).budgetState).toBe("outcome_unknown");
  });
});
