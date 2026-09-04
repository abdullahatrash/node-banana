import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

describe("release-quality migration safety", () => {
  it("does not let generated migrations redefine objects from manual migrations", () => {
    const claimedObjects = (sql: string) => [
      ...sql.matchAll(/CREATE TYPE "public"\."([^"]+)"/g),
      ...sql.matchAll(/CREATE TABLE "([^"]+)"/g),
      ...sql.matchAll(/ADD CONSTRAINT "([^"]+)"/g),
      ...sql.matchAll(/CREATE (?:UNIQUE )?INDEX "([^"]+)"/g),
      ...sql.matchAll(/ADD COLUMN "([^"]+)"/g),
    ].map((match) => match[1]);

    for (const [manualMigration, generatedMigration] of [
      ["0002_contentos_auth_org.sql", "0003_aberrant_apocalypse.sql"],
      ["0010_social_parity_remaining.sql", "0013_messy_stellaris.sql"],
    ]) {
      const manualSql = fs.readFileSync(path.join(root, "drizzle", manualMigration), "utf8");
      const generatedSql = fs.readFileSync(path.join(root, "drizzle", generatedMigration), "utf8");
      const manualObjects = new Set(claimedObjects(manualSql));
      const duplicateObjects = claimedObjects(generatedSql).filter((name) => manualObjects.has(name));

      expect(duplicateObjects, `${generatedMigration} redefines objects from ${manualMigration}`).toEqual([]);
    }
  });

  it("parenthesizes CASE expressions used inside PL/pgSQL IF predicates", () => {
    const sql = fs.readFileSync(path.join(root, "drizzle/0035_redundant_kate_bishop.sql"), "utf8");

    expect(sql).not.toMatch(/=\s+CASE\s+WHEN/);
    expect(sql).toContain("event_types[event_delta] = (CASE");
  });

  it("creates composite uniqueness before runtime usage foreign keys reference it", () => {
    const sql = fs.readFileSync(path.join(root, "drizzle/0042_runtime_usage_ledger.sql"), "utf8");
    const firstForeignKey = sql.indexOf('ADD CONSTRAINT "runtime_cost_valuation_pricing_snapshots_valuation_fk"');
    const requiredIndexes = [
      "runtime_cost_valuations_chain_target_unique",
      "runtime_cost_valuations_workspace_id_unique",
      "runtime_pricing_snapshots_workspace_id_unique",
      "runtime_pricing_snapshots_id_source_unique",
      "runtime_usage_records_chain_target_unique",
      "runtime_usage_records_workspace_settlement_id_unique",
      "usage_ledger_receipts_workspace_id_unique",
      "artifact_generated_origins_workspace_generation_identity_unique",
    ];

    expect(firstForeignKey).toBeGreaterThan(-1);
    for (const indexName of requiredIndexes) {
      const indexPosition = sql.indexOf(`CREATE UNIQUE INDEX "${indexName}"`);
      expect(indexPosition, `${indexName} must exist before dependent foreign keys`).toBeGreaterThan(-1);
      expect(indexPosition, `${indexName} must precede dependent foreign keys`).toBeLessThan(firstForeignKey);
    }
  });

  it("creates composite uniqueness before runtime budget foreign keys reference it", () => {
    const sql = fs.readFileSync(path.join(root, "drizzle/0043_runtime_budget_authority.sql"), "utf8");
    const firstForeignKey = sql.indexOf('ADD CONSTRAINT "runtime_budget_admin_receipts_workspace_fk"');
    const requiredIndexes = [
      "runtime_budget_attempt_allocations_workspace_id_unique",
      "runtime_budget_periods_workspace_id_unique",
      "runtime_budget_policies_workspace_id_unique",
      "runtime_budget_policy_revisions_workspace_id_unique",
      "runtime_budget_reservations_workspace_id_unique",
      "runtime_workspace_pricing_overrides_workspace_id_unique",
    ];

    expect(firstForeignKey).toBeGreaterThan(-1);
    for (const indexName of requiredIndexes) {
      const indexPosition = sql.indexOf(`CREATE UNIQUE INDEX "${indexName}"`);
      expect(indexPosition, `${indexName} must exist before dependent foreign keys`).toBeGreaterThan(-1);
      expect(indexPosition, `${indexName} must precede dependent foreign keys`).toBeLessThan(firstForeignKey);
    }
  });

  it("creates composite uniqueness before runtime quota foreign keys reference it", () => {
    const sql = fs.readFileSync(path.join(root, "drizzle/0044_runtime_quota_authority.sql"), "utf8");
    const firstForeignKey = sql.indexOf('ADD CONSTRAINT "runtime_quota_admin_receipts_workspace_fk"');
    const requiredIndexes = [
      "runtime_quota_policies_workspace_id_unique",
      "runtime_quota_policy_revisions_workspace_id_unique",
      "runtime_quota_policy_revisions_policy_id_unique",
      "runtime_quota_reservations_workspace_id_unique",
      "runtime_quota_windows_workspace_id_unique",
    ];

    expect(firstForeignKey).toBeGreaterThan(-1);
    for (const indexName of requiredIndexes) {
      const indexPosition = sql.indexOf(`CREATE UNIQUE INDEX "${indexName}"`);
      expect(indexPosition, `${indexName} must exist before dependent foreign keys`).toBeGreaterThan(-1);
      expect(indexPosition, `${indexName} must precede dependent foreign keys`).toBeLessThan(firstForeignKey);
    }
  });

  it("creates same-migration unique indexes before foreign keys that depend on them", () => {
    const failures: string[] = [];
    const migrations = fs.readdirSync(path.join(root, "drizzle")).filter((name) => name.endsWith(".sql"));

    for (const migration of migrations) {
      const sql = fs.readFileSync(path.join(root, "drizzle", migration), "utf8");
      const uniqueIndexes = [...sql.matchAll(/CREATE UNIQUE INDEX "([^"]+)" ON "([^"]+)"[^;]*;/g)]
        .filter((match) => !/\bWHERE\b/i.test(match[0]))
        .map((match) => ({
          name: match[1],
          table: match[2],
          columns: [...match[0].matchAll(/"([^"]+)"/g)].slice(2).map((column) => column[1]),
          position: match.index,
        }));

      for (const foreignKey of sql.matchAll(/ADD CONSTRAINT "([^"]+)" FOREIGN KEY \(([^)]+)\) REFERENCES "public"\."([^"]+)"\(([^)]+)\)/g)) {
        const referencedColumns = [...foreignKey[4].matchAll(/"([^"]+)"/g)].map((column) => column[1]);
        const supportingIndex = uniqueIndexes.find(
          (index) => index.table === foreignKey[3] && index.columns.join("\0") === referencedColumns.join("\0"),
        );

        if (supportingIndex && supportingIndex.position > foreignKey.index) {
          failures.push(`${migration}: ${supportingIndex.name} appears after ${foreignKey[1]}`);
        }
      }
    }

    expect(failures).toEqual([]);
  });

  it("keeps PostgreSQL regular-expression repetition bounds within the engine limit", () => {
    const failures: string[] = [];
    const migrations = fs.readdirSync(path.join(root, "drizzle")).filter((name) => name.endsWith(".sql"));

    for (const migration of migrations) {
      const sql = fs.readFileSync(path.join(root, "drizzle", migration), "utf8");
      for (const repetition of sql.matchAll(/\{(\d+),(\d+)\}/g)) {
        if (Number(repetition[2]) > 255) failures.push(`${migration}: ${repetition[0]}`);
      }
    }

    expect(failures).toEqual([]);
  });

  it("does not use WINDOW as an unquoted table alias", () => {
    const sql = fs.readFileSync(path.join(root, "drizzle/0045_runtime_observability.sql"), "utf8");

    expect(sql).not.toMatch(/\bAS\s+window\b/i);
  });

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

  it("commits failure evidence before the external worker reports failure", () => {
    const sql = fs.readFileSync(path.join(root, "drizzle/0084_durable_telemetry_backfill_failures.sql"), "utf8");
    const route = fs.readFileSync(path.join(root, "src/app/api/studio/internal/product-telemetry-retention/route.ts"), "utf8");
    expect(sql).toContain("BEGIN\n    RETURN QUERY");
    expect(sql).toContain("EXCEPTION WHEN OTHERS");
    expect(sql).toContain('"failure_count" = "failure_count" + 1');
    expect(sql).toContain("RETURN QUERY SELECT 0, v_remaining, 'failed'::text");
    expect(sql).not.toMatch(/RAISE\s*;/);
    expect(sql).toContain("REVOKE EXECUTE ON FUNCTION backfill_product_telemetry_privacy_fields(integer) FROM PUBLIC");
    expect(route).toContain('backfill.status === "failed"');
    expect(route).toContain('code: "TELEMETRY_BACKFILL_FAILED"');
  });
});
