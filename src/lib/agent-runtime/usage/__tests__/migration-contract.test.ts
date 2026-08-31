import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(process.cwd(), "drizzle/0042_runtime_usage_ledger.sql"),
  "utf8",
);

describe("Usage Ledger migration contract", () => {
  it("creates normalized immutable evidence tables", () => {
    for (const table of [
      "runtime_usage_records",
      "runtime_pricing_snapshots",
      "runtime_fx_snapshots",
      "runtime_cost_valuations",
      "runtime_cost_valuation_usage_records",
      "runtime_cost_valuation_pricing_snapshots",
      "runtime_usage_artifact_attributions",
      "runtime_usage_metering_events",
      "usage_ledger_receipts",
    ]) {
      expect(migration).toContain(`CREATE TABLE "${table}"`);
      expect(migration).toContain(`CREATE TRIGGER ${table}_immutable`);
    }
  });

  it("enforces unknown-not-zero, exact decimal, redaction, and correction-chain constraints", () => {
    expect(migration).toContain("runtime_usage_records_decimal_check");
    expect(migration).toContain("runtime_cost_valuations_state_check");
    expect(migration).toContain("runtime_usage_records_superseded_unique");
    expect(migration).toContain("runtime_cost_valuations_superseded_unique");
    expect(migration).toContain("runtime_usage_records_workspace_attempt_fk");
    expect(migration).toContain("runtime_usage_records_supersedes_fk");
    expect(migration).toContain("runtime_cost_valuations_supersedes_fk");
    expect(migration).toContain("runtime_usage_artifact_attributions_settlement_unique");
    expect(migration).toContain("runtime_usage_artifact_attributions_generated_origin_fk");
    expect(migration).toContain("runtime_usage_metering_events_settlement_fk");
    expect(migration).toContain("runtime_cost_valuations_settlement_fk");
    expect(migration).toContain("runtime_usage_records_settlement_fk");
    expect(migration).toContain("runtime_cost_valuation_usage_records_usage_record_fk");
    expect(migration).toContain("runtime_cost_valuation_pricing_snapshots_workspace_pricing_fk");
    expect(migration).toContain("runtime_cost_valuation_pricing_snapshots_identity_fk");
    expect(migration).toContain("^evidence:sha256:[a-f0-9]{64}$");
    expect(migration).toContain("?& array[");
    expect(migration).toContain("secret|token|password|ciphertext|prompt|content");
    expect(migration).toContain("reject_runtime_usage_ledger_mutation");
  });
});
