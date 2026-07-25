import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(process.cwd(), "drizzle/0033_nostalgic_vengeance.sql"),
  "utf8",
);
const goldenMigration = readFileSync(
  resolve(process.cwd(), "drizzle/0034_dry_katie_power.sql"),
  "utf8",
);

describe("Workflow Run PostgreSQL migration", () => {
  it("creates Run authority, retained events, scoped receipts, outbox, and leases", () => {
    for (const table of [
      "workflow_runs",
      "workflow_run_events",
      "workflow_run_mutation_receipts",
      "workflow_run_outbox_intents",
      "workflow_run_execution_leases",
    ]) {
      expect(migration).toContain(`CREATE TABLE "${table}"`);
    }

    expect(migration).toContain(
      'PRIMARY KEY("workspace_id","principal_id","capability","idempotency_key")',
    );
    expect(migration).toContain(
      '"workflow_runs_authorization_evidence_fk"',
    );
    expect(migration).toContain(
      '"workflow_run_events_workspace_run_sequence_unique"',
    );
    expect(migration).not.toMatch(/CREATE TABLE "[^"]*jobs?"/i);
    expect(migration).not.toMatch(/"job_id"|"payload"/i);
  });

  it("installs immutable history, lifecycle, outbox, and fencing guards", () => {
    expect(migration).toContain('"workflow_run_events_insert_only"');
    expect(migration).toContain('"workflow_run_events_insert_guarded"');
    expect(migration).toContain('"workflow_run_events_canonical"');
    expect(migration).toContain(
      "Terminal Workflow Runs reject additional events",
    );
    expect(migration).toContain('"workflow_run_receipts_insert_only"');
    expect(migration).toContain('"workflow_run_acceptance_complete"');
    expect(migration).toContain("DEFERRABLE INITIALLY DEFERRED");
    expect(migration).toContain('"workflow_runs_identity_immutable"');
    expect(migration).toContain(
      "Workflow Run completion requires exactly two events",
    );
    expect(migration).toContain(
      "Workflow Run failure requires exactly one event",
    );
    expect(migration).toContain(
      "Workflow Run outbox delivery attempts must advance monotonically",
    );
    expect(migration).toContain('"workflow_run_lease_fence_monotonic"');
    expect(migration).toContain(
      "Workflow Run execution fence must advance monotonically",
    );
  });

  it("creates referenced composite uniqueness before adding foreign keys", () => {
    const authorizationUnique = migration.indexOf(
      'CREATE UNIQUE INDEX "agent_authorization_decisions_run_evidence_unique"',
    );
    const revisionUnique = migration.indexOf(
      'CREATE UNIQUE INDEX "content_workflow_revisions_workspace_workflow_id_unique"',
    );
    const authorizationForeignKey = migration.indexOf(
      '"workflow_runs_authorization_evidence_fk"',
    );
    const revisionForeignKey = migration.indexOf(
      '"workflow_runs_workspace_workflow_revision_fk"',
    );

    expect(authorizationUnique).toBeGreaterThanOrEqual(0);
    expect(revisionUnique).toBeGreaterThanOrEqual(0);
    expect(authorizationUnique).toBeLessThan(authorizationForeignKey);
    expect(revisionUnique).toBeLessThan(revisionForeignKey);
  });

  it("adds durable Step Attempts, final snapshots, and canonical multi-step guards", () => {
    expect(goldenMigration).toContain(
      'CREATE TABLE "workflow_step_attempts"',
    );
    expect(goldenMigration).toContain(
      '"workflow_step_attempts_workspace_effect_key_unique"',
    );
    expect(goldenMigration).toContain('"final_snapshot" jsonb');
    expect(goldenMigration).toContain(
      '"workflow_runs_final_snapshot_check"',
    );
    expect(goldenMigration).toContain(
      'CREATE OR REPLACE FUNCTION "workflow_run_event_insert_guard"',
    );
    expect(goldenMigration).toContain(
      "Running Workflow Run transition has invalid attempt events",
    );
    expect(goldenMigration).toContain(
      "Workflow Run failure events are missing or out of order",
    );
    expect(goldenMigration).toContain(
      "previous_type = 'step.attempt.failed'",
    );
    expect(goldenMigration).toContain(
      '"workflow_step_attempts_identity_immutable"',
    );
    expect(goldenMigration).toContain(
      "'workflow_runs.start@1', 'workflow_runs.start@2'",
    );
  });
});
