import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = ["drizzle/0058_overconfident_rockslide.sql", "drizzle/0059_modern_slayback.sql", "drizzle/0060_green_grandmaster.sql"].map((path) => readFileSync(path, "utf8")).join("\n");

describe("S2 governance migration", () => {
  it("pins all records to a Workspace and protects append-only evidence", () => {
    expect(migration).toContain('CREATE TABLE "workspace_governance_resources"');
    expect(migration).toContain('CREATE TABLE "workspace_governance_mutation_receipts"');
    expect(migration).toContain('CREATE TABLE "workspace_audit_trail_events"');
    expect(migration).toContain("ON DELETE restrict");
    expect(migration).toContain("workspace_audit_trail_events_append_only");
    expect(migration).toContain("workspace_governance_mutation_receipts_append_only");
  });

  it("has bounded payloads, version checks, and every canonical S2 resource kind", () => {
    for (const kind of ["custom_role", "portfolio", "review_guest_grant", "approval_policy", "approval_request", "step_up_session", "audit_export", "workspace_export", "workspace_import", "data_region_policy", "retention_policy", "safety_decision", "safety_appeal", "bulk_operation", "workspace_closure"]) {
      expect(migration).toContain(`'${kind}'`);
    }
    expect(migration).toContain('"version" > 0');
    expect(migration).toContain("octet_length");
  });
});
