import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(join(process.cwd(), "drizzle/0120_trend_ranking_context_repair.sql"), "utf8");

describe("trend ranking-context repair migration", () => {
  it("repairs databases that applied the original 0117 migration", () => {
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS "ranking_context" jsonb');
    expect(migration).toContain("TREND_RANKING_CONTEXT_MIGRATED_UNPINNED");
    expect(migration).toContain('"lease_owner" = NULL');
    expect(migration).toContain('ALTER COLUMN "ranking_context" SET NOT NULL');
  });

  it("backfills a source-bound, schema-valid context and restores its constraint", () => {
    expect(migration).toContain("'brandProfile', NULL");
    expect(migration).toContain("'preferredArabicVarieties', sources.\"preferred_arabic_varieties\"");
    expect(migration).toContain("jsonb_typeof(\"ranking_context\")='object'");
  });
});
