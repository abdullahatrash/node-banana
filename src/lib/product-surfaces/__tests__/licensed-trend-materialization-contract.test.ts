import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("licensed trend materialization contract", () => {
  const worker = readFileSync("src/lib/product-surfaces/licensed-trend-materialization.ts", "utf8");
  const inspiration = readFileSync("src/lib/product-surfaces/inspiration-commands.ts", "utf8");

  it("verifies source and evidence copies before rights and Inspiration creation", () => {
    for (const contract of ["copyObjectInS3", "verifyCopiedObject", "createImmutableRightsEvidence", "inspirationRightsSnapshots", "catalogBinding", "createProductRecordInTransaction"]) expect(worker).toContain(contract);
  });

  it("rechecks catalog entitlement at the Blitz boundary", () => {
    expect(inspiration).toContain("assertLicensedCatalogBindingActive");
    expect(inspiration).toContain("INSPIRATION_CATALOG_LICENSE_INACTIVE");
  });
});
