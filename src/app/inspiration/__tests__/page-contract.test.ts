import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Inspiration page feed merge", () => {
  it("never reclassifies an excluded ingested trend as a manual source", () => {
    const source = readFileSync("src/app/inspiration/page.tsx", "utf8");
    expect(source).toContain("rows.filter((row) => !row.payload.trendEvidence)");
    expect(source).not.toContain("!trendIds.has(row.id)");
  });

  it("renders the separately entitled licensed catalog before the workspace feed", () => {
    const source = readFileSync("src/app/inspiration/page.tsx", "utf8");
    expect(source).toContain("listLicensedTrendCatalog");
    expect(source).toContain("<LicensedTrendCatalog items={licensedCatalog} />");
  });
});
