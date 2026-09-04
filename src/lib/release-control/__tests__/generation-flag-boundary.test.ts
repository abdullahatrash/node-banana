import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("admitted generation release-flag boundary", () => {
  it("fails closed in production and evaluates the authoritative flag before provider access", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "src/lib/model-routing/execute-admitted-generation.ts"), "utf8");
    expect(source).toContain("GENERATION_RELEASE_FLAG_UNCONFIGURED");
    expect(source).toContain("evaluateReleaseFlag");
    expect(source).toContain("GENERATION_RELEASE_FLAG_DISABLED");
    expect(source.indexOf("evaluateReleaseFlag")).toBeLessThan(source.indexOf("const credential ="));
    expect(source.indexOf("evaluateReleaseFlag")).toBeLessThan(source.indexOf("productionGenerationExecution(credential).execute"));
  });
});
