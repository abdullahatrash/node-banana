import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("generation Workspace budget admission", () => {
  it("uses the same canonical runtime committed-spend expression as workflow budgets", () => {
    const runtime = readFileSync("src/lib/model-routing/runtime-budget-authority.ts", "utf8");
    const canonical = readFileSync("src/lib/agent-runtime/budgets/postgres-repository.ts", "utf8");
    expect(runtime).toContain("runtimeCommittedAmountSql()");
    expect(canonical.match(/runtimeCommittedAmountSql\(\)/g)).toHaveLength(2);
    expect(runtime).not.toContain("sum(${runtimeBudgetReservations.heldAmount}");
  });
});
