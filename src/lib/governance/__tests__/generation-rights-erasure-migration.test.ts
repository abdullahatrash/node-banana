import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync("drizzle/0114_generation_rights_evidence_erasure.sql", "utf8");
const repository = readFileSync("src/lib/governance/postgres-repository.ts", "utf8");
const closureAdapter = readFileSync("src/lib/governance/closure-production.ts", "utf8");
const service = readFileSync("src/lib/governance/service.ts", "utf8");
const operations = readFileSync("docs/operations/generation-rights-erasure.md", "utf8");

function between(start: string, end: string): string {
  const from = sql.indexOf(start);
  const to = sql.indexOf(end, from + start.length);
  expect(from).toBeGreaterThanOrEqual(0);
  expect(to).toBeGreaterThan(from);
  return sql.slice(from, to);
}

describe("generation rights evidence erasure migration", () => {
  it("uses a non-login owner, execute-only worker, and hardened function resolution", () => {
    expect(sql.match(/NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS/g)).toHaveLength(2);
    expect(sql).toContain("generation rights eraser owner role must not have members");
    expect(sql).toContain("SECURITY DEFINER SET search_path = pg_catalog, pg_temp");
    expect(sql).not.toContain("SET search_path = pg_catalog, public");
    expect(sql).toContain("CREATE EXTENSION IF NOT EXISTS pgcrypto");
    expect(sql).toContain("pg_catalog.pg_extension");
    expect(sql).toContain("%I.hmac");
    expect(sql).toContain("had_membership boolean:=pg_catalog.pg_has_role");
    expect(sql).toContain("generation rights eraser owner role retained an unexpected member");
    expect(sql).toContain("REVOKE CREATE ON SCHEMA public FROM PUBLIC");
    expect(sql).toContain("generation rights erasure roles must not create objects in public");
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION[\s\S]*public\.erase_closed_workspace_generation_rights\(text,text,text,integer\) FROM PUBLIC/);
    expect(sql).toContain("GRANT EXECUTE ON FUNCTION public.erase_closed_workspace_generation_rights(text,text,text,integer) TO tasmeemai_workspace_closure_worker");
    expect(sql).toContain('REVOKE ALL ON TABLE "generation_rights_erasure_tombstones", "generation_rights_erasure_attempts", "inspiration_rights_evidence"');
    expect(operations).toContain("Never grant that role to the web application");
    expect(operations).toContain("separate connection pool");
  });

  it("derives exact lease, workspace, export, access, dependency and receipt readiness in the database", () => {
    const fn = between("CREATE FUNCTION public.erase_closed_workspace_generation_rights", "REVOKE ALL ON FUNCTION public.tasmeemai_pgcrypto");
    for (const requirement of ["v_closure.\"status\" IS DISTINCT FROM 'erasure_running'", "v_closure.\"body\"->>'erasureScheduled' IS DISTINCT FROM 'true'", "IS DISTINCT FROM p_lease_id", "p_lease_fence", "workspace-access-revocation-evidence/v1", "blocked_export", "blocked_deletion_receipts", "blocked_dependencies"]) expect(fn).toContain(requirement);
    expect(fn).toContain('FROM public."workspaces" WHERE "id"=p_workspace_id AND "deleted_at" IS NULL');
    expect(fn).not.toContain("p_evaluated_at");
    expect(fn).not.toContain("p_retained_resources");
  });

  it("blocks weak policies, active rights holds, malformed holds, and ambiguous legacy holds", () => {
    expect(sql).toContain("retention-policy-revision/v2");
    expect(sql).toContain("deployment_trusted/v2");
    expect(sql).toContain("v_floor<>365");
    expect(sql).toContain("tasmeemai_try_nonnegative_integer(v_rule->>'legalFloorDays') IS NULL");
    expect(sql).toContain("v_duration>36500");
    expect(sql).toContain("pg_catalog.isfinite(parsed)");
    expect(sql).toContain("LANGUAGE plpgsql STABLE STRICT");
    expect(sql).toContain("tasmeemai_try_timestamptz(hold.\"body\"->>'expiresAt') IS NULL");
    expect(sql).toContain("retention-hold-scope-review/v2");
    expect(sql).toContain("reviewedAgainstPolicyRevision");
    expect(sql).toContain("blocked_retention_hold");
    expect(sql).toContain("blocked_retention_period");
    expect(service).toContain("normalizeRetentionPolicyRules(command.rules)");
    expect(service).toContain('schema: "retention-policy-revision/v2"');
  });

  it("uses consistent governance/audit locks and blocks inserts for closed or missing Workspaces", () => {
    expect(sql).toContain("'workspace-governance:' || p_workspace_id");
    expect(sql).toContain("'workspace-audit:' || p_workspace_id");
    expect(sql).toContain("'workspace-governance:' || NEW.\"workspace_id\"");
    expect(repository).toContain("workspace-governance:${input.receipt.workspaceId}");
    expect(sql.match(/NOT EXISTS \(SELECT 1 FROM public\."workspaces" WHERE "id"=NEW\."workspace_id" AND "deleted_at" IS NULL\)/g)).toHaveLength(3);
    expect(sql).toContain('BEFORE INSERT OR UPDATE OR DELETE ON "inspiration_rights_evidence"');
    expect(sql).toContain('BEFORE INSERT OR UPDATE OR DELETE ON "inspiration_rights_snapshots"');
    expect(sql).toContain('CREATE TRIGGER "generation_intents_closure_guard" BEFORE INSERT OR UPDATE ON "generation_intents"');
    expect(sql).not.toMatch(/DISABLE\s+TRIGGER|session_replication_role/i);
  });

  it("stores only keyed record-set proof and verifies replay against MAC, audit, and receipt", () => {
    const table = between('CREATE TABLE "generation_rights_erasure_tombstones"', 'CREATE TABLE "generation_rights_erasure_attempts"');
    expect(table).toContain('"erasure_manifest_mac"');
    expect(table).not.toContain("erasure_manifest_digest");
    for (const sensitive of ["source_asset_id", "evidence_document_asset_id", "issuer_id", "verified_by_user_id", "source_url", "record_digest"]) expect(table.toLowerCase()).not.toContain(sensitive);
    expect(sql).toContain("tasmeemai_pgcrypto_hmac_sha256");
    expect(sql).toContain("generation rights erasure replay proof invalid");
    expect(sql).toContain('"event"=v_expected_audit');
    expect(sql).toContain('"result"=v_expected_result');
    expect(sql).toContain("generation_rights_erasure_signing_key_id");
    expect(sql.indexOf("RETURN QUERY SELECT 'replayed'::text")).toBeGreaterThan(sql.indexOf("generation rights erasure replay proof invalid"));
    expect(operations).toContain("historical HMAC keys");
  });

  it("persists signed, append-only blocked attempts rather than rolling expected denials back", () => {
    expect(sql).toContain('CREATE TABLE "generation_rights_erasure_attempts"');
    expect(sql).toContain("generation_rights_erasure_attempts_append_only");
    expect(sql).toContain("workspace_closures.erase_generation_rights_attempt@1");
    expect(sql).toContain("'leaseId',p_lease_id");
    expect(sql).toContain("generation-rights-erasure-attempt-result/v1");
    expect(sql).toContain("'outcome','failed'");
    expect(sql).toContain("RETURN QUERY SELECT 'blocked_retention_policy'::text");
  });

  it("orders external erasure by dependency and requires finalization preservation proof", () => {
    const direct = closureAdapter.indexOf("const prerequisiteEffects");
    const rights = closureAdapter.indexOf("const rightsEffect");
    const remaining = closureAdapter.indexOf("const remainingEffects");
    const assets = closureAdapter.indexOf("const assetEffects");
    const governance = closureAdapter.indexOf("const governanceEffects");
    const identity = closureAdapter.indexOf("const identityEffect");
    expect(direct).toBeLessThan(rights);
    expect(rights).toBeLessThan(remaining);
    expect(remaining).toBeLessThan(assets);
    expect(assets).toBeLessThan(governance);
    expect(governance).toBeLessThan(identity);
    expect(closureAdapter).toContain("CLOSURE_PROOF_PRESERVATION_NOT_PROVEN");
    expect(closureAdapter).toContain("WORKSPACE_IDENTITY_MUST_USE_CANONICAL_CLOSE_REDACTION");
    expect(closureAdapter).toContain('"active workspace_closure resource"');
    expect(closureAdapter).toContain('"workspace closure completion tombstone"');
  });
});
