import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("licensed trend materialization contract", () => {
  const worker = readFileSync("src/lib/product-surfaces/licensed-trend-materialization.ts", "utf8");
  const inspiration = readFileSync("src/lib/product-surfaces/inspiration-commands.ts", "utf8");
  const smoke = readFileSync("scripts/smoke-licensed-trends.mjs", "utf8");

  it("verifies source and evidence copies before rights and Inspiration creation", () => {
    for (const contract of ["copyObjectInS3", "verifyCopiedObject", "createImmutableRightsEvidence", "inspirationRightsSnapshots", "catalogBinding", "createProductRecordInTransaction"]) expect(worker).toContain(contract);
  });

  it("rechecks catalog entitlement at the Blitz boundary", () => {
    expect(inspiration).toContain("assertLicensedCatalogBindingActive");
    expect(inspiration).toContain("INSPIRATION_CATALOG_LICENSE_INACTIVE");
  });

  it("keeps the real-backend smoke across the Brand-aware no-spend Blitz boundary", () => {
    for (const contract of [
      "Brand-aware Blitz queue",
      'brief?.schema !== "brand-aware-remix-brief/v1"',
      'brief.locale?.arabicVariety !== "gulf"',
      "brief.protectedExpressionExcluded !== true",
      "credits and Generation Intents unchanged",
      "noSpendState",
    ]) expect(smoke).toContain(contract);
  });
});
