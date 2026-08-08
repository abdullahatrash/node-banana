import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { publishingPlanAuthorizationContractDigest } from "../authorization-contract";

function migration(): string {
  return readFileSync(
    resolve(process.cwd(), "drizzle/0046_runtime_publishing_plans.sql"),
    "utf8",
  );
}

describe("Publishing Plan migration contract", () => {
  it("creates workspace-scoped head, immutable revisions, and receipts", () => {
    const sql = migration();
    for (const table of [
      "runtime_publishing_plans",
      "runtime_publishing_plan_revisions",
      "runtime_publishing_plan_mutation_receipts",
    ]) {
      expect(sql).toContain(`CREATE TABLE "${table}"`);
    }
    expect(sql).toContain(
      'CONSTRAINT "runtime_publishing_plans_pk" PRIMARY KEY("workspace_id","id")',
    );
    expect(sql).toContain(
      'CONSTRAINT "runtime_publishing_plan_revisions_pk" PRIMARY KEY("workspace_id","id")',
    );
    expect(sql).toContain(
      'CONSTRAINT "runtime_publishing_plan_mutation_receipts_pk" PRIMARY KEY("workspace_id","principal_id","capability","idempotency_key")',
    );
    expect(sql).toContain(
      '"runtime_publishing_plan_revisions_workspace_plan_revision_unique"',
    );
    expect(sql).toContain(
      '"runtime_publishing_plan_mutation_receipts_validation_session_unique"',
    );
    expect(sql).toContain(
      '"runtime_publishing_plan_mutation_receipts_validation_session_check"',
    );
  });

  it("binds author, key, and creation authorization without mutable resource FKs", () => {
    const sql = migration();
    for (const constraint of [
      "runtime_publishing_plans_workspace_creator_fk",
      "runtime_publishing_plans_creator_key_fk",
      "runtime_publishing_plans_creation_authorization_evidence_fk",
      "runtime_publishing_plan_revisions_workspace_author_fk",
      "runtime_publishing_plan_revisions_author_key_fk",
      "runtime_publishing_plan_revisions_creation_authorization_evidence_fk",
      "runtime_publishing_plan_mutation_receipts_authorization_evidence_fk",
      "runtime_publishing_plan_mutation_receipts_revision_fk",
    ]) {
      expect(sql).toContain(`"${constraint}"`);
    }
    expect(sql).not.toContain('REFERENCES "public"."social_accounts"');
    expect(sql).not.toContain('REFERENCES "public"."artifacts"');
    expect(sql.match(/ON DELETE restrict/g)?.length).toBeGreaterThanOrEqual(13);
  });

  it("installs referenced uniqueness before receipt foreign keys", () => {
    const sql = migration();
    const revisionIdentity = sql.indexOf(
      '"runtime_publishing_plan_revisions_workspace_plan_id_unique"',
    );
    const receiptRevisionFk = sql.indexOf(
      '"runtime_publishing_plan_mutation_receipts_revision_fk"',
    );

    expect(revisionIdentity).toBeGreaterThan(-1);
    expect(receiptRevisionFk).toBeGreaterThan(-1);
    expect(revisionIdentity).toBeLessThan(receiptRevisionFk);
  });

  it("closes and bounds durable definition and evidence", () => {
    const sql = migration();
    expect(sql).toContain(
      '"runtime_publishing_plan_revisions_definition_check"',
    );
    expect(sql).toContain(
      "publishing-plan-revision-definition/v1",
    );
    const definitionCheck = sql.slice(
      sql.indexOf("runtime_publishing_plan_revisions_definition_check"),
      sql.indexOf("runtime_publishing_plan_revisions_validation_evidence_check"),
    );
    expect(definitionCheck).not.toContain("contextId");
    expect(sql).toContain(
      "publishing-plan-validation-evidence/v1",
    );
    expect(sql).toContain(
      `->'authorizesExecution' = 'false'::jsonb`,
    );
    expect(sql).toContain("jsonb_array_length");
    expect(sql).toContain("octet_length");
    expect(sql).toContain("::timestamptz");
    expect(sql).toContain("validation_evidence_digest");
    expect(sql).toContain("submittedDraftDigest");
    expect(sql).toContain("currentStateDigest");
    expect(sql).toContain(
      `authorizationContractDigest' = '${publishingPlanAuthorizationContractDigest(
        "publishing_plan_revisions.create@1",
      )}'`,
    );
  });

  it("prevents historical mutation and unsafe head advancement", () => {
    const sql = migration();
    expect(sql).toContain(
      '"runtime_publishing_plan_revisions_insert_only"',
    );
    expect(sql).toContain(
      '"runtime_publishing_plan_mutation_receipts_insert_only"',
    );
    expect(sql).toContain(
      '"runtime_publishing_plans_identity_immutable"',
    );
    expect(sql).toContain(
      "to_jsonb(NEW) - ARRAY['current_revision', 'updated_at']",
    );
    expect(sql).toContain(
      "NEW.current_revision <> OLD.current_revision + 1",
    );
    expect(sql).toContain(
      "Publishing Plan head must reference an immutable revision",
    );
  });

  it("provides FK and reverse-keyset indexes", () => {
    const sql = migration();
    for (const index of [
      "runtime_publishing_plans_workspace_creator_idx",
      "runtime_publishing_plans_creator_key_idx",
      "runtime_publishing_plans_creation_authorization_evidence_idx",
      "runtime_publishing_plan_revisions_workspace_author_idx",
      "runtime_publishing_plan_revisions_author_key_idx",
      "runtime_publishing_plan_revisions_creation_authorization_evidence_idx",
      "runtime_publishing_plan_mutation_receipts_key_idx",
      "runtime_publishing_plan_mutation_receipts_authorization_evidence_idx",
      "runtime_publishing_plan_mutation_receipts_revision_idx",
      "runtime_publishing_plan_revisions_workspace_created_idx",
      "runtime_publishing_plan_revisions_workspace_plan_created_idx",
    ]) {
      expect(sql).toContain(`CREATE INDEX "${index}"`);
    }
    for (const columns of [
      '("created_by_principal_id","created_by_key_id")',
      '("workspace_id","created_by_principal_id","created_by_key_id","creation_authorization_evidence_ref")',
      '("author_principal_id","author_key_id")',
      '("workspace_id","author_principal_id","author_key_id","creation_authorization_evidence_ref")',
      '("principal_id","key_id")',
      '("workspace_id","principal_id","key_id","authorization_evidence_ref")',
      '("workspace_id","plan_id","revision_id")',
    ]) {
      expect(sql).toContain(columns);
    }
    expect(sql).toContain(
      '("workspace_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST)',
    );
    expect(sql).toContain(
      '("workspace_id","plan_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST)',
    );
  });

  it("keeps the generated snapshot and journal in parity", () => {
    const snapshot = JSON.parse(
      readFileSync(
        resolve(process.cwd(), "drizzle/meta/0046_snapshot.json"),
        "utf8",
      ),
    ) as { tables: Record<string, unknown> };
    const journal = readFileSync(
      resolve(process.cwd(), "drizzle/meta/_journal.json"),
      "utf8",
    );
    for (const table of [
      "runtime_publishing_plans",
      "runtime_publishing_plan_revisions",
      "runtime_publishing_plan_mutation_receipts",
    ]) {
      expect(snapshot.tables).toHaveProperty(`public.${table}`);
    }
    expect(journal).toContain('"tag": "0046_runtime_publishing_plans"');
  });
});
