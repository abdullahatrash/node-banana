import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

describe("release-quality migration safety", () => {
  it("does not perform an unbounded telemetry rewrite in 0076", () => {
    const sql = fs.readFileSync(path.join(root, "drizzle/0076_experiment_assignments_and_telemetry_retention.sql"), "utf8");
    expect(sql).not.toMatch(/UPDATE\s+"product_telemetry_events"/i);
    expect(sql).not.toMatch(/ALTER COLUMN "(?:subject_pseudonym|region_classification|expires_at)" SET NOT NULL/i);
  });

  it("provides a bounded, resumable and observable corrective backfill", () => {
    const sql = fs.readFileSync(path.join(root, "drizzle/0080_release_quality_backfill_and_flag_runtime.sql"), "utf8");
    expect(sql).toContain("product_telemetry_backfill_progress");
    expect(sql).toContain("LIMIT p_limit");
    expect(sql).toContain("FOR UPDATE SKIP LOCKED");
    expect(sql).toContain('"failure_count" = "failure_count" + 1');
    expect(sql).toContain("backfill_product_telemetry_privacy_fields");
  });

  it("schedules telemetry retention through a cron-compatible handler", () => {
    const config = JSON.parse(fs.readFileSync(path.join(root, "vercel.json"), "utf8")) as { crons: Array<{ path: string }> };
    const route = fs.readFileSync(path.join(root, "src/app/api/studio/internal/product-telemetry-retention/route.ts"), "utf8");
    expect(config.crons).toContainEqual(expect.objectContaining({ path: "/api/studio/internal/product-telemetry-retention?limit=500" }));
    expect(route).toContain("export const GET = POST");
  });
});
