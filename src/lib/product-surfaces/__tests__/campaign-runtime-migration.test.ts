import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(join(process.cwd(), "drizzle/0094_campaign_scheduling_blitz_replenishment.sql"), "utf8");
const schema = readFileSync(join(process.cwd(), "src/lib/db/schema.ts"), "utf8");

describe("campaign runtime persistence", () => {
  it("pins immutable occurrence identity and fences leased state changes", () => {
    expect(migration).toContain("product_campaign_occurrence_snapshot_immutable");
    expect(migration).toContain("lease_generation");
    expect(migration).toContain("'submitting'");
    expect(migration).toContain("'outcome_unknown'");
    expect(schema).toContain("productCampaignOccurrences");
  });

  it("persists exact replenishment replay receipts and a rotating scan cursor", () => {
    expect(migration).toContain("product_blitz_replenishment_runs_source_unique");
    expect(migration).toContain("product_blitz_replenishment_items_blitz_unique");
    expect(migration).toContain("product_runtime_scan_checkpoints");
    expect(schema).toContain("productBlitzReplenishmentItems");
  });
});
