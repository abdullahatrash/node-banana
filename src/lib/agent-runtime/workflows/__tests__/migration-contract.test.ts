import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function migration(): string {
  return readFileSync(
    resolve(process.cwd(), "drizzle/0032_happy_kang.sql"),
    "utf8",
  );
}

describe("Content Workflow migration contract", () => {
  it("creates canonical workspace-composite Workflow persistence", () => {
    const sql = migration();
    for (const table of [
      "content_workflows",
      "content_workflow_revisions",
      "workflow_revision_mutation_receipts",
    ]) {
      expect(sql).toContain(`CREATE TABLE "${table}"`);
    }
    expect(sql).toContain(
      'CONSTRAINT "content_workflows_pk" PRIMARY KEY("workspace_id","id")',
    );
    expect(sql).toContain(
      'CONSTRAINT "content_workflow_revisions_pk" PRIMARY KEY("workspace_id","id")',
    );
    expect(sql).toContain(
      '"content_workflow_revisions_workspace_workflow_revision_unique"',
    );
    expect(sql).toContain(
      '"content_workflow_revisions_workspace_workflow_fk"',
    );
    expect(sql).toContain('"content_workflows_workspace_creator_fk"');
    expect(sql).toContain(
      '"content_workflow_revisions_workspace_author_fk"',
    );
    expect(sql).toContain('"content_workflows_creator_key_fk"');
    expect(sql).toContain('"content_workflow_revisions_author_key_fk"');
    expect(sql).not.toContain('REFERENCES "public"."projects"');
  });

  it("installs referenced indexes before foreign keys and triggers", () => {
    const sql = migration();
    const keyIndex = sql.indexOf('"agent_keys_principal_id_unique"');
    const identityIndex = sql.indexOf(
      '"content_workflow_revisions_workspace_workflow_revision_unique"',
    );
    const firstCreatorKeyFk = Math.min(
      sql.indexOf('"content_workflows_creator_key_fk"'),
      sql.indexOf('"content_workflow_revisions_author_key_fk"'),
    );
    const workflowFk = sql.indexOf(
      '"content_workflow_revisions_workspace_workflow_fk"',
    );
    const firstTrigger = sql.indexOf(
      'CREATE TRIGGER "content_workflow_revisions_insert_only"',
    );

    expect(keyIndex).toBeGreaterThan(-1);
    expect(identityIndex).toBeGreaterThan(-1);
    expect(keyIndex).toBeLessThan(firstCreatorKeyFk);
    expect(identityIndex).toBeLessThan(workflowFk);
    expect(firstCreatorKeyFk).toBeLessThan(firstTrigger);
  });

  it("makes revisions and receipts append-only while preserving Workflow provenance", () => {
    const sql = migration();
    expect(sql).toContain('"content_workflow_revisions_insert_only"');
    expect(sql).toContain(
      '"workflow_revision_mutation_receipts_insert_only"',
    );
    expect(sql).toContain('"content_workflows_identity_immutable"');
    expect(sql).toContain(
      "to_jsonb(NEW) - ARRAY['current_revision', 'updated_at']",
    );
    expect(sql).toContain(
      "RAISE EXCEPTION 'Content Workflow identities cannot be deleted'",
    );
    expect(sql).toContain(
      "NEW.current_revision <> OLD.current_revision + 1",
    );
    expect(sql).toContain("NEW.updated_at < OLD.updated_at");
    expect(sql).toContain(
      '"content_workflow_revisions_definition_digest_check"',
    );
    expect(sql).toContain(
      '"content_workflow_revisions_definition_identity_check"',
    );
    expect(sql).toContain(
      `"definition"->>'workflowId' = "content_workflow_revisions"."workflow_id"`,
    );
    expect(sql).toContain(
      '"workflow_revision_mutation_receipts_fingerprint_check"',
    );
    expect(sql).toContain('"content_workflows_evidence_check"');
    expect(sql).toContain(
      '"content_workflow_revisions_evidence_check"',
    );
  });
});
