import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("src/lib/product-surfaces/campaign-operation-control.ts", "utf8");

describe("campaign occurrence operation controls", () => {
  it("confirms cancellation only before workflow submission", () => {
    expect(source).toContain('["scheduled", "claimed"].includes(row.state)');
    expect(source).toContain('state: "cancelled"');
    expect(source).toContain('row.state === "submitting" && !row.workflowRunId');
    expect(source).toContain('state: "outcome_unknown"');
    expect(source).toContain('return { kind: "outcome_unknown" as const }');
  });

  it("derives retry from the immutable source snapshot", () => {
    expect(source).toContain('inArray(productCampaignOccurrences.state, ["failed_known", "cancelled"])');
    expect(source).toContain("source.snapshot");
    expect(source).toContain('state: "scheduled"');
  });
});
