import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("operation source projection coverage", () => {
  it("keyset-scans every source beyond an individual page", () => {
    const source = readFileSync("src/lib/agent-runtime/operation-status/source-reader.ts", "utf8");
    expect(source).toContain("readAll(pageSize");
    expect(source).toContain("order(workflowRuns.id)");
    expect(source).toContain("first(\"workflow-runs/v1\")");
    expect(source).toContain("after(updatedAt");
    expect(source).not.toContain("slice(0, limit)");
  });
  it("seeds leases for every Workspace without the former 5000 cap", () => {
    const source = readFileSync("src/lib/agent-runtime/operation-status/projection-leases.ts", "utf8");
    expect(source).toContain("select id, null, to_timestamp(0)");
    expect(source).not.toContain("limit(5_000)");
  });
});
