import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(process.cwd(), "drizzle/0044_runtime_quota_authority.sql"),
  "utf8",
);
const snapshot = JSON.parse(readFileSync(
  resolve(process.cwd(), "drizzle/meta/0044_snapshot.json"),
  "utf8",
)) as {
  tables: Record<string, {
    columns: Record<string, { notNull: boolean }>;
    checkConstraints: Record<string, { value: string }>;
  }>;
};

describe("Quota authority migration contract", () => {
  it("creates durable policy, capacity, reservation, wait, and receipt records", () => {
    for (const table of [
      "runtime_quota_policies",
      "runtime_quota_policy_revisions",
      "runtime_quota_admin_receipts",
      "runtime_quota_windows",
      "runtime_quota_reservations",
      "runtime_quota_reservation_events",
      "runtime_quota_waits",
      "runtime_quota_claim_receipts",
      "runtime_quota_transition_receipts",
      "runtime_quota_usage_reconciliation_receipts",
    ]) expect(migration).toContain(`CREATE TABLE "${table}"`);

    expect(migration).toContain("runtime_quota_policies_active_workspace_identity_unique");
    expect(migration).toContain("runtime_quota_policies_active_principal_identity_unique");
    expect(migration).toContain("runtime_quota_reservations_transition_policy_unique");
    expect(migration).toContain("runtime_quota_waits_transition_unique");
    expect(migration).toContain("runtime_quota_windows_finite_window_unique");
    expect(migration).toContain("runtime_quota_windows_open_window_unique");
    expect(migration).toContain("runtime_quota_policies_current_revision_fk");
  });

  it("defers run references so admission and the canonical run can commit atomically", () => {
    for (const constraint of [
      "runtime_quota_reservations_run_fk",
      "runtime_quota_waits_run_fk",
    ]) {
      const start = migration.indexOf(constraint);
      expect(start).toBeGreaterThanOrEqual(0);
      expect(migration.slice(start, start + 340)).toContain("DEFERRABLE INITIALLY DEFERRED");
    }
  });

  it("keeps quota history append-only and mutable projections monotonic", () => {
    for (const trigger of [
      "runtime_quota_policy_revisions_append_only",
      "runtime_quota_policy_revisions_insert_guard",
      "runtime_quota_admin_receipts_append_only",
      "runtime_quota_claim_receipts_append_only",
      "runtime_quota_transition_receipts_append_only",
      "runtime_quota_usage_reconciliation_receipts_append_only",
      "runtime_quota_reservation_events_append_only",
      "runtime_quota_windows_append_only",
      "runtime_quota_policies_guard",
      "runtime_quota_reservations_guard",
      "runtime_quota_waits_guard",
    ]) expect(migration).toContain(`CREATE TRIGGER ${trigger}`);

    expect(migration).toContain("reservation amounts and time must advance monotonically");
    expect(migration).toContain("wait evidence and identity are immutable");
    expect(migration).toContain("revoked runtime quota policies cannot be reactivated");
    expect(migration).toContain("renewable concurrency and rate quota exhaustion must wait");
    expect(migration).toContain("only renewable concurrency and rate quota exhaustion may wait");
    expect(migration).toContain('"released_amount"::numeric <= "runtime_quota_reservations"."reserved_amount"::numeric');
  });

  it("keeps quota JSON records canonical with their constrained scalar columns", () => {
    for (const constraint of [
      "runtime_quota_policies_json_shape_check",
      "runtime_quota_policies_json_scalar_check",
      "runtime_quota_policy_revisions_json_shape_check",
      "runtime_quota_policy_revisions_json_scalar_check",
      "runtime_quota_reservations_json_shape_check",
      "runtime_quota_reservations_json_scalar_check",
      "runtime_quota_waits_json_shape_check",
      "runtime_quota_waits_json_scalar_check",
    ]) expect(migration).toContain(`CONSTRAINT "${constraint}"`);

    expect(migration).toContain("resolved runtime quota wait resolution evidence is immutable");
    expect(migration).toContain("NEW.wait->'resumedBy'");
    expect(migration).toContain("NEW.wait->'resumeReason'");
    expect(migration).toContain("NEW.wait->'resumeIdempotencyKey'");
    expect(migration).toContain("NEW.wait->'resolutionReservationIds'");
  });

  it("allows capacity-release waits without inventing a retry timestamp", () => {
    const lifecycle = migration.slice(migration.lastIndexOf("workflow_runs_lifecycle_check"));
    expect(lifecycle).toContain('"workflow_runs"."failure_code" = \'QUOTA_WAIT\'');
    const quotaWait = lifecycle.slice(
      lifecycle.indexOf('"workflow_runs"."failure_code" = \'QUOTA_WAIT\''),
      lifecycle.indexOf(") or (", lifecycle.indexOf('"workflow_runs"."failure_code" = \'QUOTA_WAIT\'')),
    );
    expect(quotaWait).not.toContain('"workflow_runs"."resume_at" is not null');
    expect(quotaWait).not.toContain('"workflow_runs"."started_at" is not null');
  });

  it("supports standalone Artifact ownership and immutable usage overage reconciliation", () => {
    const reservations = migration.slice(
      migration.indexOf('CREATE TABLE "runtime_quota_reservations"'),
      migration.indexOf('CREATE TABLE "runtime_quota_transition_receipts"'),
    );
    expect(reservations).toContain('"run_id" text,');
    expect(reservations).toContain('CONSTRAINT "runtime_quota_reservations_ownership_check"');
    expect(reservations).toContain('"subject_kind" = \'artifact\' or "run_id" is not null');
    expect(reservations).toContain('"overage_amount" text NOT NULL');
    expect(reservations).toContain('runtime_quota_reservations_overage_json_check');
    expect(reservations).toContain('runtime_quota_reservations_usage_reconciliation_check');
    expect(migration).toContain('runtime_quota_usage_reconciliation_receipts_pk');
    expect(migration).toContain('runtime_quota_usage_reconciliation_receipts_workspace_fk');
    expect(migration).toContain('NEW.overage_amount::numeric < OLD.overage_amount::numeric');
  });

  it("keeps the Drizzle snapshot aligned with nullable ownership and usage reconciliation", () => {
    const reservations = snapshot.tables["public.runtime_quota_reservations"]!;
    expect(reservations.columns.run_id?.notNull).toBe(false);
    expect(reservations.columns.overage_amount?.notNull).toBe(true);
    for (const constraint of [
      "runtime_quota_reservations_ownership_check",
      "runtime_quota_reservations_overage_json_check",
      "runtime_quota_reservations_usage_reconciliation_check",
    ]) expect(reservations.checkConstraints).toHaveProperty(constraint);
    expect(snapshot.tables).toHaveProperty("public.runtime_quota_usage_reconciliation_receipts");
  });
});
