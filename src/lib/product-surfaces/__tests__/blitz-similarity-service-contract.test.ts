import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("src/lib/product-surfaces/blitz-similarity-service.ts", "utf8");
describe("Blitz similarity evidence service", () => {
  it("revalidates tenant, item revision, asset readiness, digests, and passed evidence", () => {
    expect(source.match(/eq\([^,]+\.workspaceId, input\.workspaceId\)/g)?.length).toBeGreaterThanOrEqual(8);
    expect(source).toContain('current.state !== "queued"');
    expect(source).toContain("current.revision !== input.expectedRevision");
    expect(source).toContain("validateBlitzSimilarityGate");
    expect(source).toContain('row.status !== "passed"');
  });
});
