import { describe, expect, it } from "vitest";
import { generationSpendAmounts } from "../generation-spend";

describe("generation spend settlement", () => {
  it("releases only a proven pre-start cancellation", () => {
    expect(generationSpendAmounts({ kind: "pre_start_cancelled" }, 0.75)).toEqual({ status: "released", actualAmountUsd: "0", releasedAmountUsd: "0.750000" });
  });

  it("releases a known failure for a customer refund", () => {
    expect(generationSpendAmounts({ kind: "failed_known" }, 0.75)).toEqual({ status: "released", actualAmountUsd: "0", releasedAmountUsd: "0.750000" });
  });

  it("keeps cancellation after provider submission committed until actual cost is known", () => {
    expect(generationSpendAmounts({ kind: "cost_unknown" }, 0.75)).toEqual({ status: "outcome_unknown", actualAmountUsd: null, releasedAmountUsd: "0" });
  });

  it("records authoritative successful spend", () => {
    expect(generationSpendAmounts({ kind: "succeeded", actualAmountUsd: 0.625 }, 0.75)).toEqual({ status: "settled", actualAmountUsd: "0.625000", releasedAmountUsd: "0" });
  });
});
