import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("licensed trend catalog migration", () => {
  const migration = readFileSync("drizzle/0124_licensed_trend_catalog.sql", "utf8");
  const documentAssetMigration = readFileSync("drizzle/0125_document_assets.sql", "utf8");

  it("separates immutable catalog revisions, workspace entitlements, and recoverable imports", () => {
    for (const table of ["licensed_trend_catalog_entries", "licensed_trend_catalog_revisions", "licensed_trend_workspace_entitlements", "licensed_trend_materialization_jobs"]) expect(migration).toContain(table);
    for (const guard of ["document_digest", "catalog_digest", "request_digest", "lease_generation", "failed_known", "inspiration_item_fk"]) expect(migration).toContain(guard);
  });

  it("stores license evidence as a first-class document asset", () => {
    expect(documentAssetMigration).toContain('ALTER TYPE "asset_type" ADD VALUE IF NOT EXISTS \'document\'');
  });
});
