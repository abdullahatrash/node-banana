import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("src/lib/product-surfaces/content-editor-options.ts", "utf8");

describe("Content editor canonical option projection", () => {
  it("scopes every selectable resource to the Workspace and readiness gates", () => {
    expect(source.match(/eq\([^,]+\.workspaceId, workspaceId\)/g)?.length).toBeGreaterThanOrEqual(5);
    expect(source).toContain("uploadState' = 'ready'");
    expect(source).toContain("evaluatePersonaGate");
    expect(source).toContain('eq(contentThemes.state, "active")');
    expect(source).toContain("licenseExpiresAt > now");
  });
});
