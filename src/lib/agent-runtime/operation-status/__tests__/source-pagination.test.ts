import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("operation source projection coverage", () => {
  it("exposes one bounded oldest-first keyset page per source", () => {
    const source = readFileSync("src/lib/agent-runtime/operation-status/source-reader.ts", "utf8");
    expect(source).toContain("readSourceOperationProjectionPage");
    expect(source).toContain("asc(workflowRuns.id)");
    expect(source).toContain("after(workflowRuns.updatedAt");
    expect(source).not.toContain("readAll");
  });
  it("seeds leases for every Workspace without the former 5000 cap", () => {
    const source = readFileSync("src/lib/agent-runtime/operation-status/projection-leases.ts", "utf8");
    expect(source).toContain("select id, null, to_timestamp(0)");
    expect(source).not.toContain("limit(5_000)");
  });
});
