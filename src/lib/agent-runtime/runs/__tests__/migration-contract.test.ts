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
const recoveryMigration = readFileSync(
  resolve(process.cwd(), "drizzle/0035_redundant_kate_bishop.sql"),
  "utf8",
);
const recoveryEvidenceMigration = readFileSync(
  resolve(process.cwd(), "drizzle/0036_short_network.sql"),
  "utf8",
);
const byokMigration = readFileSync(
  resolve(process.cwd(), "drizzle/0037_rapid_dexter_bennett.sql"),
  "utf8",
);
const byokMetadataGuardMigration = readFileSync(
  resolve(process.cwd(), "drizzle/0038_marvelous_spirit.sql"),
  "utf8",
);
const byokPinMigration = readFileSync(
  resolve(process.cwd(), "drizzle/0039_illegal_thundra.sql"),
  "utf8",
);
const byokFailureReceiptMigration = readFileSync(
  resolve(process.cwd(), "drizzle/0040_overrated_morlun.sql"),
  "utf8",
);
const byokArtifactMetadataMigration = readFileSync(
  resolve(process.cwd(), "drizzle/0041_grey_blink.sql"),
  "utf8",
);
const studioAssetSnapshotMigration = readFileSync(
  resolve(process.cwd(), "drizzle/0113_workflow_run_studio_asset_snapshot.sql"),
  "utf8",
);

describe("Workflow Run PostgreSQL migration", () => {
  it("adds exact v3 Studio Asset snapshots while retaining v1 and v2", () => {
    expect(studioAssetSnapshotMigration).toContain("'workflow-run-start-snapshot/v1', 'workflow-run-start-snapshot/v2', 'workflow-run-start-snapshot/v3'");
    expect(studioAssetSnapshotMigration).toContain("valid_workflow_run_studio_asset_references");
    expect(studioAssetSnapshotMigration).toContain("jsonb_typeof(\"start_snapshot\"->'providerResolutions') = 'array'");
    expect(studioAssetSnapshotMigration).toContain("jsonb_array_length(\"start_snapshot\"->'providerResolutions') > 0");
    for (const field of ["assetId", "digest", "type", "mediaType", "sizeBytes", "width", "height", "durationSeconds"]) {
      expect(studioAssetSnapshotMigration).toContain(`'${field}'`);
    }
  });
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

  it("adds derivations, retry generations, unknown outcomes, and upgraded guards", () => {
    expect(recoveryMigration).toContain('"source_run_id" text');
    expect(recoveryMigration).toContain('"root_run_id" text');
    expect(recoveryMigration).toContain('"derivation" jsonb');
    expect(recoveryMigration).toContain('"resume_at" timestamp with time zone');
    expect(recoveryMigration).toContain('"generation" integer DEFAULT 1 NOT NULL');
    expect(recoveryMigration).toContain(
      '"workflow_run_outbox_intents_workspace_run_generation_unique"',
    );
    expect(recoveryMigration).toContain(
      'CREATE INDEX "workflow_step_attempts_workspace_effect_key_idx"',
    );
    expect(recoveryMigration).toContain("'workflow_runs.retry@1'");
    expect(recoveryMigration).toContain("'workflow_runs.reconcile@1'");
    expect(recoveryMigration).toContain("'workflow_runs.resume@1'");
    expect(recoveryMigration).toContain("'outcome_unknown'");
    expect(recoveryMigration).toContain("'step.retry.scheduled'");
    expect(recoveryMigration).toContain(
      'CREATE OR REPLACE FUNCTION "workflow_run_identity_guard"',
    );
    expect(recoveryMigration).toContain(
      "Workflow Run start snapshot, derivation, and provenance are immutable",
    );
    expect(recoveryMigration).toContain(
      'CREATE OR REPLACE FUNCTION "workflow_step_attempt_identity_guard"',
    );
    expect(recoveryMigration).toContain(
      "Workflow Run event stream has an invalid canonical transition",
    );
    expect(recoveryMigration).toContain(
      "Workflow Run transition events are incomplete",
    );
    expect(recoveryMigration).toContain(
      "Reconciled Step Attempt event has no reconciliation evidence",
    );
    expect(recoveryMigration).toContain(
      '"intent_digest" = NEW.data->>\'intentDigest\'',
    );
    expect(recoveryMigration).toContain(
      '"attempt"::text = NEW.data->>\'attempt\'',
    );
    expect(recoveryMigration).toContain(
      '"failure_code" = NEW.data->>\'reasonCode\'',
    );
    expect(recoveryMigration).toContain(
      '"resume_at" = (NEW.data->>\'retryAt\')::timestamptz',
    );
    expect(recoveryMigration).toContain(
      "'priorSucceededProviderOperationRef'",
    );
    expect(recoveryMigration).toContain(
      "Durable provider success evidence cannot be contradicted",
    );
    expect(recoveryMigration).toContain(
      '"workflow_step_attempts_provider_evidence_check"',
    );
  });

  it("backfills and foreign-keys exact authorization evidence on mutation receipts", () => {
    expect(recoveryEvidenceMigration).toContain(
      'ADD COLUMN "key_id" text;',
    );
    expect(recoveryEvidenceMigration).toContain(
      'ADD COLUMN "authorization_evidence_ref" text;',
    );
    expect(recoveryEvidenceMigration).toContain(
      'UPDATE "workflow_run_mutation_receipts" AS receipt',
    );
    expect(recoveryEvidenceMigration).toContain(
      '"workflow_run_mutation_receipts_authorization_evidence_fk"',
    );
  });

  it("admits v2 provider snapshots and persists normalized provider evidence", () => {
    expect(byokMigration).toContain(
      'ADD COLUMN "provider_metadata" jsonb',
    );
    expect(byokMigration).toContain("workflow-run-start-snapshot/v2");
    expect(byokMigration).toContain("workflow-run-start-snapshot/v1");
    expect(byokMetadataGuardMigration).toContain(
      'octet_length("workflow_step_attempts"."provider_metadata"::text) <= 65536',
    );
    for (const column of [
      "provider_adapter_module",
      "provider_adapter_contract_digest",
      "launch_safety",
    ]) {
      expect(byokPinMigration).toContain(`ADD COLUMN "${column}"`);
    }
    expect(byokPinMigration).toContain(
      '"workflow_step_attempts_adapter_identity_check"',
    );
    expect(byokPinMigration).toContain(
      "jsonb_array_length(\"workflow_runs\".\"start_snapshot\"->'providerResolutions') > 0",
    );
    expect(byokPinMigration).toContain(
      'CREATE OR REPLACE FUNCTION "workflow_step_attempt_identity_guard"',
    );
    expect(byokPinMigration).toMatch(
      /'provider_operation_ref', 'provider_metadata',[\s\S]*'provider_operation_ref', 'provider_metadata'/,
    );
    expect(byokFailureReceiptMigration).toContain(
      '"credential_spend_events_state_check"',
    );
    expect(byokFailureReceiptMigration).toMatch(
      /status" = 'failed'[\s\S]*failure_code" is not null/,
    );
    expect(byokArtifactMetadataMigration).toContain(
      'ALTER TABLE "artifact_generated_origins" ADD COLUMN "provider_metadata" jsonb',
    );
    expect(byokArtifactMetadataMigration).toContain(
      '"artifact_generated_origins_provider_metadata_redaction_check"',
    );
    expect(byokArtifactMetadataMigration).toContain(
      'jsonb_typeof("artifact_generated_origins"."provider_metadata") = \'object\'',
    );
  });
});
