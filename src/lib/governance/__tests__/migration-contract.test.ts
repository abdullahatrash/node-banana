import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = ["drizzle/0058_overconfident_rockslide.sql", "drizzle/0059_modern_slayback.sql", "drizzle/0060_green_grandmaster.sql", "drizzle/0061_atomic_governance_membership.sql", "drizzle/0065_governance_secret_deliveries.sql", "drizzle/0066_governance_replay_identity.sql", "drizzle/0067_governance_projection_claims.sql"].map((path) => readFileSync(path, "utf8")).join("\n");
const repository = readFileSync("src/lib/governance/postgres-repository.ts", "utf8");
const membershipProjection = readFileSync("src/lib/governance/membership-postgres.ts", "utf8");
const deployment = readFileSync("vercel.json", "utf8");

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
    for (const kind of ["custom_role", "portfolio", "review_guest_grant", "approval_policy", "approval_request", "step_up_session", "audit_export", "workspace_export", "workspace_import", "data_region_policy", "retention_policy", "safety_decision", "safety_appeal", "bulk_operation", "workspace_closure", "membership_projection"]) {
      expect(migration).toContain(`'${kind}'`);
    }
    expect(migration).toContain('"version" > 0');
    expect(migration).toContain("octet_length");
  });

  it("commits canonical membership in the ledger transaction and never writes Better Auth tables directly", () => {
    expect(repository).toContain("applyCanonicalEffect(tx, effect)");
    expect(repository.indexOf("applyCanonicalEffect(tx, effect)")).toBeLessThan(repository.indexOf("workspaceGovernanceMutationReceipts).values"));
    expect(membershipProjection).not.toContain("insert(member)");
    expect(membershipProjection).not.toContain("update(member)");
    expect(membershipProjection).not.toContain("delete(member)");
  });

  it("binds bounded secret replay to authenticated identity and indexes projection recovery", () => {
    expect(migration).toContain('"actor_identity"');
    expect(migration).toContain('"auth_context_digest"');
    expect(migration).toContain("workspace_governance_secret_deliveries_actor_binding_check");
    expect(migration).toContain("workspace_governance_membership_projection_claim_idx");
    expect(deployment).toContain('"path": "/api/studio/internal/governance-sweep"');
    expect(deployment).toContain('"schedule": "* * * * *"');
  });
});
