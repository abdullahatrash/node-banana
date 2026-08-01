import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(process.cwd(), "drizzle/0043_runtime_budget_authority.sql"),
  "utf8",
);

describe("Budget authority migration contract", () => {
  it("creates normalized policy, admission, reservation, pricing, and spend-control tables", () => {
    for (const table of [
      "runtime_budget_policies",
      "runtime_budget_policy_revisions",
      "runtime_budget_admin_receipts",
      "runtime_budget_periods",
      "runtime_budget_admissions",
      "runtime_budget_admission_grants",
      "runtime_budget_attempt_allocations",
      "runtime_budget_attempt_reservation_allocations",
      "runtime_budget_reservations",
      "runtime_budget_reservation_events",
      "runtime_budget_settlement_receipts",
      "runtime_workspace_pricing_overrides",
      "runtime_workspace_pricing_override_revisions",
      "runtime_spend_controls",
      "runtime_spend_control_events",
    ]) {
      expect(migration).toContain(`CREATE TABLE "${table}"`);
    }
  });

  it("makes history append-only and guards mutable projections", () => {
    for (const table of [
      "runtime_budget_policy_revisions",
      "runtime_budget_admin_receipts",
      "runtime_budget_periods",
      "runtime_budget_admissions",
      "runtime_budget_admission_grants",
      "runtime_budget_attempt_allocations",
      "runtime_budget_attempt_reservation_allocations",
      "runtime_budget_reservation_events",
      "runtime_budget_settlement_receipts",
      "runtime_workspace_pricing_override_revisions",
      "runtime_spend_control_events",
    ]) {
      expect(migration).toContain(`CREATE TRIGGER ${table}_immutable`);
    }
    expect(migration).toContain("runtime_budget_policies_guard");
    expect(migration).toContain("runtime_budget_reservations_guard");
    expect(migration).toContain("runtime_workspace_pricing_overrides_guard");
    expect(migration).toContain("runtime_spend_controls_guard");
    expect(migration).toContain("reservation update time is monotonic");
    expect(migration).toContain("spend control revisions must advance monotonically");
  });

  it("preserves exact decimals, stable policy identity, and referential evidence", () => {
    expect(migration).toContain("runtime_budget_policy_revisions_decimal_check");
    expect(migration).toContain("runtime_budget_reservations_amount_check");
    expect(migration).toContain("runtime_workspace_pricing_overrides_decimal_check");
    expect(migration).toContain("runtime_budget_policies_active_workspace_unique");
    expect(migration).toContain("runtime_budget_policies_active_principal_unique");
    expect(migration).toContain("runtime_budget_policies_current_revision_fk");
    expect(migration).toContain("DEFERRABLE INITIALLY DEFERRED");
    expect(migration).toContain("runtime_budget_reservations_revision_fk");
    expect(migration).toContain("runtime_budget_reservation_events_valuation_fk");
    expect(migration).toContain("runtime_budget_settlement_receipts_valuation_fk");
    expect(migration).toContain("runtime_budget_reservations_period_state_idx");
    expect(migration).toContain("runtime_budget_reservation_events_reservation_occurred_idx");
    expect(migration).toContain("runtime_budget_attempt_allocations_attempt_fk");
    expect(migration).toContain("runtime_budget_attempt_allocations_grant_amount_check");
    expect(migration).toContain('"credential_effect_ref" text NOT NULL');
    expect(migration).toContain('"held_amount" text NOT NULL');
    expect(migration).toContain('"grant_amount_cents" >= 0');
    expect(migration).toContain('"reserved_cents" >= 0');
    expect(migration).toContain("effect_not_created");
  });
});
