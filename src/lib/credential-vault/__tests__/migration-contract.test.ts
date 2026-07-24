import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function migration(name: string): string {
  return readFileSync(resolve(process.cwd(), "drizzle", name), "utf8");
}

describe("credential vault migration contract", () => {
  it("stores only versioned ciphertext and disables unvaulted legacy profiles", () => {
    const sql = migration("0022_wonderful_blackheart.sql");
    expect(sql).toContain('"secret_ciphertext" text NOT NULL');
    expect(sql).not.toMatch(/"secret"\s+text/i);
    expect(sql).toContain(
      'UPDATE "credential_profiles" SET "status" = \'disabled\', "enabled" = false',
    );
    expect(sql).toContain(
      '"credential_profiles_workspace_name_unique"',
    );
    expect(sql).toContain(
      'WHERE "credential_profiles"."status" = \'active\'',
    );
  });

  it("enforces spend modes, idempotent effects, and one active grant", () => {
    const checks = migration("0023_thankful_impossible_man.sql");
    const indexes = migration("0024_far_shooting_star.sql");
    expect(checks).toContain("credential_spend_grants_mode_check");
    expect(checks).toContain("credential_spend_grants_status_check");
    expect(indexes).toContain(
      "credential_spend_events_workspace_effect_ref_unique",
    );
    expect(indexes).toContain(
      "credential_spend_grants_active_principal_profile_unique",
    );
    expect(indexes).toContain("WHERE");
  });

  it("binds credential relationships to one workspace and preserves replay facts", () => {
    const sql = migration("0025_spooky_ezekiel_stane.sql");
    expect(sql).toContain(
      '"credential_spend_events_workspace_profile_version_fk"',
    );
    expect(sql).toContain(
      '"credential_spend_events_workspace_principal_profile_grant_fk"',
    );
    expect(sql).toContain('"credential_slots_workspace_profile_fk"');
    expect(sql).toContain('"request_fingerprint" text');
    expect(sql).toContain('"resolved_version" integer');
    expect(sql).toContain('"resolved_provider" text');
  });

  it("enforces one current active version without stranding legacy profiles", () => {
    const sql = migration("0025_spooky_ezekiel_stane.sql");
    expect(sql).toContain("credential_profile_versions_one_active_unique");
    expect(sql).toContain("credential_profiles_active_version_guard");
    expect(sql).toContain("DEFERRABLE INITIALLY DEFERRED");
    expect(sql).toContain(
      'ALTER TABLE "credential_profile_versions" ADD COLUMN "workspace_id" text;',
    );
    expect(sql).toContain(
      'ALTER TABLE "credential_profile_versions" ALTER COLUMN "workspace_id" SET NOT NULL',
    );
  });

  it("records typed, safe credential security events", () => {
    const sql = migration("0025_spooky_ezekiel_stane.sql");
    const checks = migration("0027_conscious_slyde.sql");
    expect(sql).toContain(
      'CREATE TYPE "public"."credential_security_event_type" AS ENUM',
    );
    expect(sql).toContain('CREATE TABLE "credential_security_events"');
    expect(sql).toContain('"details" jsonb');
    expect(sql).not.toMatch(/credential_security_events[\s\S]*secret_ciphertext/i);
    expect(checks).toContain("credential_security_events_actor_check");
    expect(checks).toContain(
      "credential_security_events_details_redaction_check",
    );
    expect(checks).toContain(
      "credential_spend_events_request_fingerprint_check",
    );
  });

  it("serializes effect-reference reservation before replay lookup", () => {
    const repository = readFileSync(
      resolve(
        process.cwd(),
        "src/lib/credential-vault/repository.ts",
      ),
      "utf8",
    );
    const reserve = repository.indexOf("async reserveEffect");
    const lock = repository.indexOf("pg_advisory_xact_lock", reserve);
    const receiptLookup = repository.indexOf(
      ".from(credentialSpendEvents)",
      lock,
    );
    expect(reserve).toBeGreaterThan(-1);
    expect(lock).toBeGreaterThan(reserve);
    expect(receiptLookup).toBeGreaterThan(lock);
    expect(repository).toContain(
      "receipt.requestFingerprint !== input.requestFingerprint",
    );
    expect(repository).toContain("async reprovisionProfile");
    expect(repository).toContain(
      'eq(credentialProfiles.status, "disabled")',
    );
  });

  it("fails closed by stripping pre-schema JSON slot declarations during backfill", () => {
    const sql = migration("0027_conscious_slyde.sql");
    expect(sql).toContain(
      `SET "workflow_json" = "workflow_json" - 'credentialSlots'`,
    );
    expect(sql).toContain(`WHERE "workflow_json" ? 'credentialSlots'`);
  });

  it("persists result-safe effect receipts and drops mutable grant totals", () => {
    const sql = migration("0028_warm_hobgoblin.sql");
    expect(sql).toContain(
      'RENAME COLUMN "amount_cents" TO "price_ceiling_cents"',
    );
    expect(sql).toContain('ADD COLUMN "status" text DEFAULT \'pending\' NOT NULL');
    expect(sql).toContain('ADD COLUMN "safe_result" jsonb');
    expect(sql).toContain('ADD COLUMN "failure_code" text');
    expect(sql).toContain('ADD COLUMN "unknown_at" timestamp with time zone');
    expect(sql).toContain('ADD COLUMN "reconciliation_reference" text');
    expect(sql).toContain("credential_spend_events_state_check");
    expect(sql).toContain("credential_spend_events_safe_result_redaction_check");
    expect(sql).toContain(
      '"failure_code" = \'LEGACY_RECEIPT_REQUIRES_RECONCILIATION\'',
    );
    expect(sql).toContain(
      'ALTER TABLE "credential_spend_grants" DROP COLUMN "spent_cents"',
    );
  });

  it("projects spend from chargeable immutable receipts and blocks blind retry", () => {
    const repository = readFileSync(
      resolve(process.cwd(), "src/lib/credential-vault/repository.ts"),
      "utf8",
    );
    expect(repository).toContain(
      "sum(${credentialSpendEvents.priceCeilingCents})",
    );
    expect(repository).toContain(
      'inArray(credentialSpendEvents.status, [',
    );
    expect(repository).toContain('"pending"');
    expect(repository).toContain('"completed"');
    expect(repository).toContain('"unknown"');
    expect(repository).toContain(
      'kind: "reconciliation_required" as const',
    );
    expect(repository).toContain('receipt.status !== "completed"');
    expect(repository).toContain("safeResult: receipt.safeResult");
    expect(repository).toContain("async failEffectBeforeStart");
    expect(repository).toContain("async markEffectUnknown");
  });

  it("persists scoped human mutation receipts for atomic replay and conflict detection", () => {
    const sql = migration("0029_stale_gargoyle.sql");
    expect(sql).toContain(
      'CREATE TABLE "credential_human_mutation_receipts"',
    );
    expect(sql).toContain(
      '"credential_human_mutation_receipts_invocation_unique"',
    );
    expect(sql).toContain('"request_fingerprint" text NOT NULL');
    expect(sql).toContain('"safe_result" jsonb NOT NULL');
    expect(sql).toContain(
      "credential_human_mutation_receipts_request_fingerprint_check",
    );
    expect(sql).toContain(
      "credential_human_mutation_receipts_safe_result_redaction_check",
    );

    const repository = readFileSync(
      resolve(process.cwd(), "src/lib/credential-vault/repository.ts"),
      "utf8",
    );
    expect(repository).toContain("readHumanMutationReceipt");
    expect(repository).toContain("storeHumanMutationReceipt");
    expect(repository).toContain(
      "receipt.requestFingerprint !== input.receipt.requestFingerprint",
    );
  });

  it("separates immutable effect history from the mutable receipt projection", () => {
    const sql = migration("0030_cheerful_overlord.sql");
    const legacyReplayFixture = {
      source: 'FROM "credential_security_events" legacy',
      receiptJoin:
        'INNER JOIN "credential_spend_events" e',
      workspaceScope:
        'e."workspace_id" = legacy."workspace_id"',
      effectCorrelation:
        'e."effect_ref" = legacy."effect_ref"',
      safeCorrelation:
        'e."request_fingerprint"',
      eventType:
        'legacy."event_type" = \'effect.replayed\'',
      deterministicOrder:
        'ORDER BY "ledger_created_at", "ordinal", "ledger_source_id"',
    };
    expect(sql).toContain(
      'CREATE TABLE "credential_effect_audit_events"',
    );
    expect(sql).toContain(
      '"credential_effect_audit_events_effect_sequence_unique"',
    );
    expect(sql).toContain("credential_effect_audit_events_type_check");
    expect(sql).toContain("effect.reconciled");
    expect(sql).toContain("effect.released");
    expect(sql).toContain('FROM "credential_spend_events"');
    expect(sql).toContain("row_number() OVER");
    for (const fragment of Object.values(legacyReplayFixture)) {
      expect(sql).toContain(fragment);
    }
    expect(sql).toContain(
      "'legacy-replay:' || legacy.\"id\" AS ledger_source_id",
    );
    expect(sql).toContain(
      "'spend:' || e.\"id\" || ':' || v.event_type AS ledger_source_id",
    );
    expect(sql).toContain(
      '\'backfill_\' || md5("ledger_source_id" || \':\' || "effect_sequence"::text)',
    );
    const spendCandidates = sql.slice(
      sql.indexOf("WITH spend_lifecycle_candidates"),
      sql.indexOf("legacy_replay_candidates AS"),
    );
    expect(spendCandidates).not.toContain("'effect.replayed'");
    expect(sql).not.toMatch(
      /legacy\."details"\s*(?:->|#>|AS)/,
    );

    const repository = readFileSync(
      resolve(process.cwd(), "src/lib/credential-vault/repository.ts"),
      "utf8",
    );
    expect(repository).toContain("appendEffectAuditEvents");
    expect(repository).toContain("async reconcileEffect");
    expect(repository).toContain(".from(credentialEffectAuditEvents)");
  });

  it("validates a usable slot and unrevoked active version before activation", () => {
    const repository = readFileSync(
      resolve(process.cwd(), "src/lib/credential-vault/repository.ts"),
      "utf8",
    );
    const statusMethod = repository.indexOf("async setProfileStatus");
    const slotLock = repository.indexOf(".from(credentialSlots)", statusMethod);
    const versionLock = repository.indexOf(
      ".from(credentialProfileVersions)",
      slotLock,
    );
    const activeVersionCheck = repository.indexOf(
      'eq(credentialProfileVersions.status, "active")',
      versionLock,
    );
    const revokedCheck = repository.indexOf(
      "isNull(credentialProfileVersions.revokedAt)",
      activeVersionCheck,
    );
    const update = repository.indexOf(
      ".update(credentialProfiles)",
      revokedCheck,
    );
    expect(slotLock).toBeGreaterThan(statusMethod);
    expect(versionLock).toBeGreaterThan(slotLock);
    expect(activeVersionCheck).toBeGreaterThan(versionLock);
    expect(revokedCheck).toBeGreaterThan(activeVersionCheck);
    expect(update).toBeGreaterThan(revokedCheck);
  });
});
