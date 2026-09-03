import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  publishingApprovalReleaseAuthorizationContractDigest,
  publishingApprovalRequestAuthorizationContractDigest,
} from "../authorization-contract";
import {
  PUBLISHING_PLAN_RUNTIME_POLICY_IDENTITY,
  publishingPlanRuntimePolicyContractDigest,
} from "../../publishing-plans/production-digests";

const migration = readFileSync(
  resolve(process.cwd(), "drizzle/0047_runtime_publishing_approvals.sql"),
  "utf8",
);
const governanceMigration = readFileSync(
  resolve(process.cwd(), "drizzle/0063_governance_publishing_policy.sql"),
  "utf8",
);

describe("Publishing Approval migration contract", () => {
  it("creates the complete append-only approval ledger", () => {
    for (const table of [
      "runtime_publishing_approval_authority_grants",
      "runtime_publishing_approval_authority_revocations",
      "runtime_publishing_approval_authority_mutation_receipts",
      "runtime_publishing_approval_requests",
      "runtime_publishing_approval_decisions",
      "runtime_publishing_approval_mutation_receipts",
      "runtime_publishing_approval_consumptions",
    ]) {
      expect(migration).toContain(`CREATE TABLE "${table}"`);
    }
    for (const trigger of [
      "runtime_publishing_approval_authority_grants_insert_only",
      "runtime_publishing_approval_authority_revocations_insert_only",
      "runtime_publishing_approval_authority_receipts_insert_only",
      "runtime_publishing_approval_requests_insert_only",
      "runtime_publishing_approval_decisions_insert_only",
      "runtime_publishing_approval_mutation_receipts_insert_only",
      "runtime_publishing_approval_consumptions_insert_only",
    ]) expect(migration).toContain(trigger);
    expect(migration).toContain("Publishing Approval history is append-only");
    expect(migration.match(/BEFORE UPDATE OR DELETE/g)).toHaveLength(7);
  });

  it("binds requests to the exact immutable revision and validation evidence", () => {
    const identity = migration.indexOf(
      'CREATE UNIQUE INDEX "runtime_publishing_plan_revisions_approval_identity_unique"',
    );
    const revisionFk = migration.indexOf(
      'CONSTRAINT "runtime_publishing_approval_requests_revision_fk"',
    );
    expect(identity).toBeGreaterThan(-1);
    expect(identity).toBeLessThan(revisionFk);
    expect(migration.slice(revisionFk, revisionFk + 800)).toContain(
      'FOREIGN KEY ("workspace_id","plan_id","plan_revision_id","plan_revision","plan_revision_digest","validation_evidence_digest")',
    );
    expect(migration.slice(revisionFk, revisionFk + 800)).toContain(
      '("workspace_id","plan_id","id","revision","definition_digest","validation_evidence_digest")',
    );
    expect(migration).toContain(
      'CREATE INDEX "runtime_publishing_approval_requests_revision_idx" ON "runtime_publishing_approval_requests" USING btree ("workspace_id","plan_id","plan_revision_id","plan_revision","plan_revision_digest","validation_evidence_digest")',
    );
  });

  it("binds downstream audit rows to the same request and decision", () => {
    const identity = migration.indexOf(
      'CREATE UNIQUE INDEX "runtime_publishing_approval_decisions_request_identity_unique"',
    );
    const consumptionFk = migration.indexOf(
      'CONSTRAINT "runtime_publishing_approval_consumptions_decision_fk"',
    );
    const receiptFk = migration.indexOf(
      'CONSTRAINT "runtime_publishing_approval_mutation_receipts_decision_fk"',
    );
    expect(identity).toBeGreaterThan(-1);
    expect(identity).toBeLessThan(consumptionFk);
    expect(identity).toBeLessThan(receiptFk);
    expect(migration.slice(consumptionFk, consumptionFk + 500)).toContain(
      'FOREIGN KEY ("workspace_id","approval_request_id","decision_id")',
    );
    expect(migration.slice(receiptFk, receiptFk + 500)).toContain(
      'REFERENCES "public"."runtime_publishing_approval_decisions"("workspace_id","request_id","id")',
    );
  });

  it("uses durable users but never couples history to mutable Channels or membership", () => {
    expect(migration).toContain(
      'runtime_publishing_approval_authority_grants_workspace_id_workspaces_id_fk',
    );
    expect(migration).toContain('REFERENCES "public"."user"("id")');
    expect(migration).not.toContain('REFERENCES "public"."social_accounts"');
    expect(migration).not.toContain('REFERENCES "public"."workspace_members"');
    for (const index of [
      "runtime_publishing_approval_authority_grants_subject_user_idx",
      "runtime_publishing_approval_authority_grants_issuer_idx",
      "runtime_publishing_approval_authority_mutation_receipts_actor_idx",
      "runtime_publishing_approval_authority_revocations_revoker_idx",
      "runtime_publishing_approval_decisions_decider_idx",
      "runtime_publishing_approval_mutation_receipts_user_idx",
    ]) expect(migration).toContain(`CREATE INDEX "${index}"`);
  });

  it("closes exact contracts, policy, bounded JSON, and non-execution authority", () => {
    expect(migration).toContain(publishingApprovalRequestAuthorizationContractDigest());
    expect(migration).toContain(publishingApprovalReleaseAuthorizationContractDigest());
    expect(migration).toContain(PUBLISHING_PLAN_RUNTIME_POLICY_IDENTITY);
    expect(migration).toContain(publishingPlanRuntimePolicyContractDigest());
    expect(migration).toContain("jsonb_array_length");
    expect(migration).toContain("octet_length");
    expect(migration.match(/authorizes_execution.*= false/g)?.length).toBeGreaterThanOrEqual(2);
    expect(migration).toContain("'approved','denied'");
  });

  it("stamps authority history from the database and preserves first-write history", () => {
    expect(migration).toContain("runtime_publishing_approval_stamp_authority_time");
    expect(migration).toContain("NEW.issued_at := clock_timestamp()");
    expect(migration).toContain("NEW.revoked_at := clock_timestamp()");
    expect(migration).toContain("NEW.created_at := clock_timestamp()");
    expect(migration.match(/stamp_time/g)).toHaveLength(3);
  });

  it("keeps generated snapshot and journal in parity", () => {
    const snapshot = JSON.parse(readFileSync(
      resolve(process.cwd(), "drizzle/meta/0047_snapshot.json"),
      "utf8",
    )) as { tables: Record<string, unknown> };
    const journal = readFileSync(resolve(process.cwd(), "drizzle/meta/_journal.json"), "utf8");
    for (const table of [
      "runtime_publishing_approval_authority_grants",
      "runtime_publishing_approval_authority_revocations",
      "runtime_publishing_approval_authority_mutation_receipts",
      "runtime_publishing_approval_requests",
      "runtime_publishing_approval_decisions",
      "runtime_publishing_approval_mutation_receipts",
      "runtime_publishing_approval_consumptions",
    ]) expect(snapshot.tables).toHaveProperty(`public.${table}`);
    expect(snapshot.tables).toHaveProperty("public.runtime_publishing_plan_revisions");
    expect(journal).toContain('"tag": "0047_runtime_publishing_approvals"');
  });

  it("adds a closed exact Governance Publishing Policy binding", () => {
    expect(governanceMigration).toContain('ADD COLUMN "governance_policy" jsonb');
    expect(governanceMigration).toContain("publishing-approval-governance-binding/v1");
    expect(governanceMigration).toContain("policyRevision");
    expect(governanceMigration).toContain("policyDigest");
    expect(governanceMigration).toContain("governanceRequestId");
  });
});
