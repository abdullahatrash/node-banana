import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve(process.cwd(), "drizzle/0045_runtime_observability.sql"), "utf8");
interface SnapshotTable {
  columns: Record<string, { generated?: { as: string; type: string } }>;
  foreignKeys: Record<string, { columnsFrom: string[]; tableTo: string; onDelete: string }>;
  checkConstraints: Record<string, { value: string }>;
}

const snapshot = JSON.parse(readFileSync(resolve(process.cwd(), "drizzle/meta/0045_snapshot.json"), "utf8")) as { tables: Record<string, unknown> };
const contractEvidenceSnapshot = snapshot.tables["public.runtime_contract_evidence_versions"] as SnapshotTable;

describe("Observability migration contract", () => {
  it("creates retention, aggregate delta, trace access, grant, contract, and frozen bundle evidence", () => { for (const table of ["runtime_contract_evidence_versions", "runtime_contract_evidence_backfill_quarantine", "runtime_observability_retention_policies", "runtime_observability_retention_revisions", "runtime_operational_metrics", "runtime_operational_metric_delta_receipts", "runtime_diagnostic_traces", "runtime_diagnostic_trace_access_audits", "runtime_telemetry_operator_grants", "runtime_telemetry_operator_grant_audits", "runtime_support_bundles", "runtime_support_bundle_access_audits", "runtime_support_bundle_audit_events", "runtime_support_bundle_bind_intents", "runtime_support_bundle_receipts"]) { expect(migration).toContain(`CREATE TABLE "${table}"`); expect(snapshot.tables).toHaveProperty(`public.${table}`); } });
  it("cascades metric receipts with expired buckets and bounds sensitive retention", () => { expect(migration).toContain('runtime_operational_metric_delta_receipts_aggregate_fk'); expect(migration).toContain('ON DELETE cascade'); expect(migration).toContain('"trace_ttl_seconds" between 60 and 2592000'); expect(migration).toContain('"support_bundle_ttl_seconds" between 60 and 604800'); });
  it("enforces low-cardinality and leakage-safe records", () => { expect(migration).toContain("runtime_operational_metrics_name_check"); expect(migration).toContain("runtime_operational_metrics_leakage_check"); expect(migration).toContain("runtime_diagnostic_traces_leakage_check"); expect(migration).toContain("runtime_diagnostic_trace_access_audits_outcome_check"); expect(migration).toContain("runtime_support_bundles_size_check"); });
  it("permits authorization traces while rejecting non-schema payload keys", () => { const traceTable = migration.slice(migration.indexOf('CREATE TABLE "runtime_diagnostic_traces"'), migration.indexOf('CREATE TABLE "runtime_observability_admin_receipts"')); expect(traceTable).toContain("'authorization'"); expect(traceTable).toContain("?& array['schema','operatorTraceRef'"); expect(traceTable).toContain("- array['schema','operatorTraceRef'"); expect(traceTable).not.toContain('"trace"::text !~*'); });
  it("audits nonexistent bundle probes in a separate Workspace-bound append-only table", () => { expect(migration).toContain('runtime_support_bundle_access_audits_workspace_id_workspaces_id_fk'); const accessFk = migration.slice(migration.indexOf('ALTER TABLE "runtime_support_bundle_access_audits"'), migration.indexOf('ALTER TABLE "runtime_support_bundle_receipts"')); expect(accessFk).not.toContain("bundle_fk"); expect(migration).toContain('runtime_support_bundle_audit_events_bundle_fk'); expect(migration).toContain("runtime_support_bundle_access_audits_outcome_check"); });
  it("keeps retained receipts, revisions, and access/security audits append-only without blocking receipt cascade expiry", () => { for (const trigger of ["runtime_observability_retention_revisions_append_only", "runtime_observability_admin_receipts_append_only", "runtime_diagnostic_trace_access_audits_append_only", "runtime_telemetry_operator_grant_audits_append_only", "runtime_support_bundle_access_audits_append_only", "runtime_support_bundle_audit_events_append_only", "runtime_support_bundle_receipts_append_only"]) expect(migration).toContain(`CREATE TRIGGER ${trigger}`); expect(migration).not.toContain("runtime_operational_metric_delta_receipts_append_only"); });
  it("keeps versioned mutable-resource evidence append-only and leakage constrained", () => { expect(migration).toContain("runtime_contract_evidence_versions_append_only"); expect(migration).toContain("runtime_contract_evidence_versions_pk"); expect(migration).toContain("runtime_contract_evidence_versions_kind_check"); expect(migration).toContain("runtime_contract_evidence_versions_projection_check"); expect(migration).toContain("prompt|content|secret|token|password|ciphertext|credential"); });
  it("validates Contract Evidence as closed, deeply typed projections and rejects JSON-null bypasses", () => {
    const validator = migration.slice(
      migration.indexOf("CREATE FUNCTION runtime_contract_evidence_projection_is_valid("),
      migration.indexOf('CREATE TABLE "runtime_contract_evidence_versions"'),
    );
    for (const schema of [
      "support-run-summary/v1",
      "support-budget-summary/v1",
      "support-quota-reservation-summary/v1",
      "support-quota-wait-summary/v1",
    ]) expect(validator).toContain(schema);
    for (const nestedShape of [
      "ARRAY['kind','timezone','startsAt','endsAt']",
      "ARRAY['kind','id']",
      "ARRAY['dimension','unit','amount']",
      "projection->'pricingSnapshotIds'",
      "projection->'claims'",
      "projection->'resolutionReservationIds'",
    ]) expect(validator).toContain(nestedShape);
    expect(validator.match(/RETURN coalesce\(/g)).toHaveLength(4);
    expect(validator).not.toMatch(/RETURN projection->>/);
    expect(validator).toContain("jsonb_typeof(projection->'state') = 'string'");
    expect(validator).toContain("jsonb_typeof(claim->'unit') IS DISTINCT FROM 'string'");
    expect(validator).toContain("jsonb_typeof(item) IS DISTINCT FROM 'string'");
    expect(validator.match(/::timestamptz IS NOT NULL/g)?.length).toBeGreaterThanOrEqual(13);
    expect(validator).toContain("EXCEPTION WHEN others THEN");
    expect(validator).toContain("identity_pattern constant text := '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,249}[A-Za-z0-9._:/-]{0,250}$'");
    expect(validator).toContain("timezone_pattern constant text := '^[A-Za-z0-9][A-Za-z0-9._+:/-]{0,127}$'");
    expect(contractEvidenceSnapshot.checkConstraints.runtime_contract_evidence_versions_projection_check.value)
      .toContain("runtime_contract_evidence_projection_is_valid");
  });
  it("binds each evidence row to exactly one generated mutable owner with cascade retention", () => {
    const owners = [
      ["run_owner_id", "workflow_runs", "runtime_contract_evidence_versions_run_owner_fk"],
      ["budget_reservation_owner_id", "runtime_budget_reservations", "runtime_contract_evidence_versions_budget_reservation_owner_fk"],
      ["quota_reservation_owner_id", "runtime_quota_reservations", "runtime_contract_evidence_versions_quota_reservation_owner_fk"],
      ["quota_wait_owner_id", "runtime_quota_waits", "runtime_contract_evidence_versions_quota_wait_owner_fk"],
    ] as const;
    for (const [column, ownerTable, fkName] of owners) {
      expect(contractEvidenceSnapshot.columns[column]?.generated).toMatchObject({ type: "stored" });
      expect(contractEvidenceSnapshot.columns[column]?.generated?.as).toContain("resource_id");
      expect(contractEvidenceSnapshot.foreignKeys[fkName]).toMatchObject({
        columnsFrom: ["workspace_id", column],
        tableTo: ownerTable,
        onDelete: "cascade",
      });
      expect(migration).toContain(`"${column}" text GENERATED ALWAYS AS`);
    }
    expect(migration).toContain("runtime_contract_evidence_versions_owner_check");
    expect(migration).toContain("num_nonnulls(\"run_owner_id\", \"budget_reservation_owner_id\", \"quota_reservation_owner_id\", \"quota_wait_owner_id\") = 1");
  });
  it("allows evidence deletion only from a nested owner cascade after owner absence", () => {
    const guard = migration.slice(
      migration.indexOf("CREATE FUNCTION runtime_contract_evidence_versions_append_only_guard()"),
      migration.indexOf("CREATE TRIGGER runtime_observability_retention_revisions_append_only"),
    );
    expect(guard).toContain("TG_OP = 'DELETE' AND pg_trigger_depth() > 1");
    expect(guard.match(/SELECT EXISTS \(/g)).toHaveLength(4);
    for (const ownerTable of ["workflow_runs", "runtime_budget_reservations", "runtime_quota_reservations", "runtime_quota_waits"]) {
      expect(guard).toContain(`FROM ${ownerTable}`);
    }
    expect(guard).toContain("IF NOT owner_exists THEN");
    expect(migration).toContain("EXECUTE FUNCTION runtime_contract_evidence_versions_append_only_guard()");
  });
  it("routes every legacy owner exclusively to safe v1 evidence or digest-only quarantine", () => {
    const backfill = migration.slice(
      migration.indexOf("Historical mutable owners predate Contract Evidence producers"),
      migration.indexOf("CREATE FUNCTION runtime_observability_reject_append_only_mutation()"),
    );
    expect(backfill.match(/INSERT INTO runtime_contract_evidence_versions/g)).toHaveLength(4);
    expect(backfill.match(/INSERT INTO runtime_contract_evidence_backfill_quarantine/g)).toHaveLength(4);
    expect(backfill.match(/evidence_insert AS \(/g)).toHaveLength(4);
    for (const ownerTable of ["workflow_runs AS run", "runtime_budget_reservations AS reservation", "runtime_quota_reservations AS reservation", "runtime_quota_waits AS wait"]) {
      expect(backfill).toContain(ownerTable);
    }
    expect(backfill.match(/resource_id, 1, canonical_digest/g)).toHaveLength(4);
    expect(backfill.match(/projection, projection_digest, created_at/g)).toHaveLength(8);
    expect(backfill.match(/runtime_contract_evidence_canonical_json\(source\.canonical_source\)/g)).toHaveLength(4);
    expect(backfill.match(/runtime_contract_evidence_canonical_json\(source\.projection\)/g)).toHaveLength(4);
    expect(backfill.match(/WHERE runtime_contract_evidence_projection_is_valid/g)).toHaveLength(4);
    expect(backfill.match(/WHERE NOT runtime_contract_evidence_projection_is_valid/g)).toHaveLength(4);
    expect(backfill.match(/RETURNING workspace_id/g)).toHaveLength(4);
    expect(backfill).not.toContain("ON CONFLICT DO NOTHING");
  });
  it("sanitizes hostile legacy arrays, identities, and decimals before exclusive routing", () => {
    const backfill = migration.slice(
      migration.indexOf("Historical mutable owners predate Contract Evidence producers"),
      migration.indexOf("CREATE FUNCTION runtime_observability_reject_append_only_mutation()"),
    );
    expect(backfill.match(/ordinality <= 64/g)).toHaveLength(3);
    expect(backfill).toContain("length(claim.value->>'amount') <= 81");
    expect(backfill).toContain("wait.wait->'subject'->>'id' ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,249}[A-Za-z0-9._:/-]{0,250}$'");
    expect(backfill.match(/item.value #>> '\{\}'\) ~ '\^\[A-Za-z0-9\]/g)).toHaveLength(2);
    expect(backfill).toContain("canonical_digest, 'LEGACY_PROJECTION_INVALID', created_at");
  });
  it("keeps quarantine append-only, Workspace-bound, and free of raw IDs or content", () => {
    const quarantine = migration.slice(
      migration.indexOf('CREATE TABLE "runtime_contract_evidence_backfill_quarantine"'),
      migration.indexOf('CREATE TABLE "runtime_diagnostic_trace_access_audits"'),
    );
    expect(quarantine).toContain('"workspace_id" text NOT NULL');
    expect(quarantine).toContain('"resource_reference_digest" text NOT NULL');
    expect(quarantine).toContain('"canonical_owner_digest" text NOT NULL');
    expect(quarantine).toContain("'LEGACY_PROJECTION_INVALID'");
    expect(quarantine).not.toContain('"resource_id"');
    expect(quarantine).not.toContain('"projection"');
    expect(quarantine).not.toContain('"content"');
    expect(migration).toContain("runtime_contract_evidence_backfill_quarantine_workspace_id_workspaces_id_fk");
    expect(migration).toContain("runtime_contract_evidence_backfill_quarantine_append_only");

    const quarantineSnapshot = snapshot.tables["public.runtime_contract_evidence_backfill_quarantine"] as SnapshotTable;
    expect(Object.keys(quarantineSnapshot.columns).sort()).toEqual([
      "canonical_owner_digest",
      "reason_code",
      "recorded_at",
      "resource_kind",
      "resource_reference_digest",
      "workspace_id",
    ]);
    expect(quarantineSnapshot.foreignKeys.runtime_contract_evidence_backfill_quarantine_workspace_id_workspaces_id_fk)
      .toMatchObject({ tableTo: "workspaces", columnsFrom: ["workspace_id"], onDelete: "restrict" });
  });
  it("bounds bind payloads and permits only guarded scheduling, binding, abandonment, and cleanup transitions", () => { expect(migration).toContain("runtime_support_bundle_bind_intents_size_check"); expect(migration).toContain("octet_length(\"payload_json\") between 1 and 10000000"); expect(migration).toContain("runtime_support_bundle_bind_intents_transition_guard"); expect(migration).toContain("OLD.state = 'pending' AND NEW.state in ('pending','bound','abandoned')"); expect(migration).toContain("OLD.state = 'bound' AND NEW.state = 'cleanup'"); expect(migration).toContain("OLD.state = 'abandoned' AND NEW.state = 'abandoned'"); expect(migration).toContain("NEW.payload_json IS NOT DISTINCT FROM OLD.payload_json"); });
});
