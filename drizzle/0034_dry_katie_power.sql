CREATE TABLE "artifact_generated_origins" (
	"workspace_id" text NOT NULL,
	"artifact_id" text NOT NULL,
	"artifact_origin" text DEFAULT 'generated' NOT NULL,
	"workflow_id" text NOT NULL,
	"workflow_revision_id" text NOT NULL,
	"workflow_revision" integer NOT NULL,
	"definition_digest" text NOT NULL,
	"run_id" text NOT NULL,
	"run_start_snapshot_digest" text NOT NULL,
	"step_attempt_id" text NOT NULL,
	"step_id" text NOT NULL,
	"attempt" integer NOT NULL,
	"provider" text NOT NULL,
	"operation_identity" text NOT NULL,
	"provider_operation" text NOT NULL,
	"provider_operation_ref" text NOT NULL,
	"model" text NOT NULL,
	"intent_digest" text NOT NULL,
	"effect_key" text NOT NULL,
	"output_name" text NOT NULL,
	"generated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "artifact_generated_origins_pk" PRIMARY KEY("workspace_id","artifact_id"),
	CONSTRAINT "artifact_generated_origins_revision_attempt_check" CHECK ("artifact_generated_origins"."workflow_revision" > 0 and "artifact_generated_origins"."attempt" > 0),
	CONSTRAINT "artifact_generated_origins_artifact_origin_check" CHECK ("artifact_generated_origins"."artifact_origin" = 'generated'),
	CONSTRAINT "artifact_generated_origins_digest_check" CHECK ("artifact_generated_origins"."definition_digest" ~ '^sha256:[0-9a-f]{64}$'
        and "artifact_generated_origins"."run_start_snapshot_digest" ~ '^sha256:[0-9a-f]{64}$'
        and "artifact_generated_origins"."intent_digest" ~ '^sha256:[0-9a-f]{64}$'),
	CONSTRAINT "artifact_generated_origins_identity_check" CHECK (length("artifact_generated_origins"."step_id") between 1 and 200
        and length("artifact_generated_origins"."provider") between 1 and 200
        and length("artifact_generated_origins"."operation_identity") between 1 and 300
        and length("artifact_generated_origins"."provider_operation") between 1 and 300
        and length("artifact_generated_origins"."provider_operation_ref") between 1 and 500
        and length("artifact_generated_origins"."model") between 1 and 300
        and length("artifact_generated_origins"."effect_key") between 1 and 500
        and length("artifact_generated_origins"."output_name") between 1 and 200
        and btrim("artifact_generated_origins"."effect_key") = "artifact_generated_origins"."effect_key"
        and btrim("artifact_generated_origins"."output_name") = "artifact_generated_origins"."output_name"
        and btrim("artifact_generated_origins"."provider_operation_ref") = "artifact_generated_origins"."provider_operation_ref"
        and "artifact_generated_origins"."effect_key" !~ '[[:cntrl:]]'
        and "artifact_generated_origins"."provider_operation_ref" !~ '[[:cntrl:]]'
        and "artifact_generated_origins"."output_name" !~ '[[:cntrl:]]')
);
--> statement-breakpoint
CREATE TABLE "artifact_lineage_inputs" (
	"workspace_id" text NOT NULL,
	"artifact_id" text NOT NULL,
	"position" integer NOT NULL,
	"port" text NOT NULL,
	"kind" text NOT NULL,
	"source_kind" text NOT NULL,
	"source_input_name" text,
	"source_run_id" text,
	"source_step_attempt_id" text,
	"source_output_name" text,
	"content_digest" text NOT NULL,
	"source_artifact_id" text,
	CONSTRAINT "artifact_lineage_inputs_pk" PRIMARY KEY("workspace_id","artifact_id","position"),
	CONSTRAINT "artifact_lineage_inputs_position_check" CHECK ("artifact_lineage_inputs"."position" >= 0),
	CONSTRAINT "artifact_lineage_inputs_kind_check" CHECK ("artifact_lineage_inputs"."kind" in ('text', 'image')),
	CONSTRAINT "artifact_lineage_inputs_digest_check" CHECK ("artifact_lineage_inputs"."content_digest" ~ '^sha256:[0-9a-f]{64}$'),
	CONSTRAINT "artifact_lineage_inputs_port_check" CHECK (length("artifact_lineage_inputs"."port") between 1 and 200
        and btrim("artifact_lineage_inputs"."port") = "artifact_lineage_inputs"."port"
        and "artifact_lineage_inputs"."port" !~ '[[:cntrl:]]'),
	CONSTRAINT "artifact_lineage_inputs_source_check" CHECK ((
        "artifact_lineage_inputs"."source_kind" = 'workflow_input'
        and "artifact_lineage_inputs"."source_input_name" is not null
        and length("artifact_lineage_inputs"."source_input_name") between 1 and 200
        and "artifact_lineage_inputs"."source_run_id" is null
        and "artifact_lineage_inputs"."source_step_attempt_id" is null
        and "artifact_lineage_inputs"."source_output_name" is null
      ) or (
        "artifact_lineage_inputs"."source_kind" = 'step_output'
        and "artifact_lineage_inputs"."source_input_name" is null
        and "artifact_lineage_inputs"."source_run_id" is not null
        and "artifact_lineage_inputs"."source_step_attempt_id" is not null
        and "artifact_lineage_inputs"."source_output_name" is not null
        and length("artifact_lineage_inputs"."source_output_name") between 1 and 200
        and "artifact_lineage_inputs"."source_artifact_id" is not null
      ))
);
--> statement-breakpoint
CREATE TABLE "workflow_step_attempts" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"run_id" text NOT NULL,
	"step_id" text NOT NULL,
	"attempt" integer NOT NULL,
	"state" text NOT NULL,
	"operation_identity" text NOT NULL,
	"operation_contract_digest" text NOT NULL,
	"provider" text NOT NULL,
	"provider_operation" text NOT NULL,
	"model" text NOT NULL,
	"intent_digest" text NOT NULL,
	"effect_key" text NOT NULL,
	"inputs" jsonb NOT NULL,
	"outputs" jsonb,
	"failure_code" text,
	"started_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "workflow_step_attempts_attempt_check" CHECK ("workflow_step_attempts"."attempt" > 0),
	CONSTRAINT "workflow_step_attempts_state_check" CHECK ("workflow_step_attempts"."state" in ('running', 'completed', 'failed')),
	CONSTRAINT "workflow_step_attempts_operation_identity_check" CHECK ("workflow_step_attempts"."operation_identity" ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+@[1-9][0-9]{0,8}$'),
	CONSTRAINT "workflow_step_attempts_digest_check" CHECK ("workflow_step_attempts"."operation_contract_digest" ~ '^sha256:[0-9a-f]{64}$'
        and "workflow_step_attempts"."intent_digest" ~ '^sha256:[0-9a-f]{64}$'),
	CONSTRAINT "workflow_step_attempts_identity_fields_check" CHECK (length("workflow_step_attempts"."id") between 1 and 200
        and length("workflow_step_attempts"."step_id") between 1 and 200
        and length("workflow_step_attempts"."provider") between 1 and 200
        and length("workflow_step_attempts"."provider_operation") between 1 and 200
        and length("workflow_step_attempts"."model") between 1 and 200
        and length("workflow_step_attempts"."effect_key") between 1 and 500),
	CONSTRAINT "workflow_step_attempts_payload_check" CHECK (jsonb_typeof("workflow_step_attempts"."inputs") = 'array'
        and octet_length("workflow_step_attempts"."inputs"::text) <= 262144
        and (
          "workflow_step_attempts"."outputs" is null
          or (
            jsonb_typeof("workflow_step_attempts"."outputs") = 'object'
            and octet_length("workflow_step_attempts"."outputs"::text) <= 262144
          )
        )),
	CONSTRAINT "workflow_step_attempts_lifecycle_check" CHECK ((
        "workflow_step_attempts"."state" = 'running'
          and "workflow_step_attempts"."outputs" is null
          and "workflow_step_attempts"."failure_code" is null
          and "workflow_step_attempts"."completed_at" is null
      ) or (
        "workflow_step_attempts"."state" = 'completed'
          and "workflow_step_attempts"."outputs" is not null
          and "workflow_step_attempts"."failure_code" is null
          and "workflow_step_attempts"."completed_at" is not null
          and "workflow_step_attempts"."completed_at" >= "workflow_step_attempts"."started_at"
      ) or (
        "workflow_step_attempts"."state" = 'failed'
          and "workflow_step_attempts"."outputs" is null
          and "workflow_step_attempts"."failure_code" is not null
          and "workflow_step_attempts"."completed_at" is not null
          and "workflow_step_attempts"."completed_at" >= "workflow_step_attempts"."started_at"
      )),
	CONSTRAINT "workflow_step_attempts_failure_code_check" CHECK ("workflow_step_attempts"."failure_code" is null or "workflow_step_attempts"."failure_code" ~ '^[A-Z][A-Z0-9_]{0,79}$')
);
--> statement-breakpoint
ALTER TABLE "artifacts" DROP CONSTRAINT "artifacts_origin_check";--> statement-breakpoint
ALTER TABLE "workflow_run_events" DROP CONSTRAINT "workflow_run_events_type_check";--> statement-breakpoint
ALTER TABLE "workflow_run_mutation_receipts" DROP CONSTRAINT "workflow_run_mutation_receipts_capability_check";--> statement-breakpoint
ALTER TABLE "workflow_runs" DROP CONSTRAINT "workflow_runs_lifecycle_check";--> statement-breakpoint
ALTER TABLE "artifacts" ALTER COLUMN "imported_at" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD COLUMN "final_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD COLUMN "final_snapshot_digest" text;--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_step_attempts_workspace_id_unique" ON "workflow_step_attempts" USING btree ("workspace_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_step_attempts_workspace_run_id_unique" ON "workflow_step_attempts" USING btree ("workspace_id","run_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "artifacts_workspace_id_origin_unique" ON "artifacts" USING btree ("workspace_id","id","origin");--> statement-breakpoint
CREATE UNIQUE INDEX "artifacts_workspace_id_kind_digest_unique" ON "artifacts" USING btree ("workspace_id","id","kind","content_digest");--> statement-breakpoint
ALTER TABLE "artifact_generated_origins" ADD CONSTRAINT "artifact_generated_origins_workspace_artifact_fk" FOREIGN KEY ("workspace_id","artifact_id","artifact_origin") REFERENCES "public"."artifacts"("workspace_id","id","origin") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifact_generated_origins" ADD CONSTRAINT "artifact_generated_origins_workspace_revision_fk" FOREIGN KEY ("workspace_id","workflow_id","workflow_revision_id") REFERENCES "public"."content_workflow_revisions"("workspace_id","workflow_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifact_generated_origins" ADD CONSTRAINT "artifact_generated_origins_workspace_run_fk" FOREIGN KEY ("workspace_id","workflow_id","run_id") REFERENCES "public"."workflow_runs"("workspace_id","workflow_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifact_generated_origins" ADD CONSTRAINT "artifact_generated_origins_workspace_attempt_fk" FOREIGN KEY ("workspace_id","run_id","step_attempt_id") REFERENCES "public"."workflow_step_attempts"("workspace_id","run_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifact_lineage_inputs" ADD CONSTRAINT "artifact_lineage_inputs_workspace_generated_fk" FOREIGN KEY ("workspace_id","artifact_id") REFERENCES "public"."artifact_generated_origins"("workspace_id","artifact_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifact_lineage_inputs" ADD CONSTRAINT "artifact_lineage_inputs_workspace_source_artifact_fk" FOREIGN KEY ("workspace_id","source_artifact_id","kind","content_digest") REFERENCES "public"."artifacts"("workspace_id","id","kind","content_digest") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifact_lineage_inputs" ADD CONSTRAINT "artifact_lineage_inputs_workspace_source_attempt_fk" FOREIGN KEY ("workspace_id","source_run_id","source_step_attempt_id") REFERENCES "public"."workflow_step_attempts"("workspace_id","run_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_step_attempts" ADD CONSTRAINT "workflow_step_attempts_workspace_run_fk" FOREIGN KEY ("workspace_id","run_id") REFERENCES "public"."workflow_runs"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "artifact_generated_origins_workspace_effect_output_unique" ON "artifact_generated_origins" USING btree ("workspace_id","effect_key","output_name");--> statement-breakpoint
CREATE INDEX "artifact_generated_origins_workspace_run_idx" ON "artifact_generated_origins" USING btree ("workspace_id","run_id","step_attempt_id","output_name");--> statement-breakpoint
CREATE INDEX "artifact_lineage_inputs_workspace_source_idx" ON "artifact_lineage_inputs" USING btree ("workspace_id","source_artifact_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_step_attempts_workspace_run_step_attempt_unique" ON "workflow_step_attempts" USING btree ("workspace_id","run_id","step_id","attempt");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_step_attempts_workspace_effect_key_unique" ON "workflow_step_attempts" USING btree ("workspace_id","effect_key");--> statement-breakpoint
CREATE INDEX "workflow_step_attempts_workspace_run_started_idx" ON "workflow_step_attempts" USING btree ("workspace_id","run_id","started_at","step_id","attempt");--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_origin_lifecycle_check" CHECK ((
        "artifacts"."origin" = 'imported'
        and "artifacts"."imported_at" is not null
      ) or (
        "artifacts"."origin" = 'generated'
        and "artifacts"."imported_at" is null
      ));--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_origin_check" CHECK ("artifacts"."origin" in ('imported', 'generated'));--> statement-breakpoint
ALTER TABLE "workflow_run_events" ADD CONSTRAINT "workflow_run_events_type_check" CHECK ("workflow_run_events"."type" in (
        'run.accepted',
        'step.attempt.started',
        'artifact.generated',
        'step.attempt.completed',
        'step.attempt.failed',
        'step.completed',
        'run.completed',
        'run.failed'
      ));--> statement-breakpoint
ALTER TABLE "workflow_run_mutation_receipts" ADD CONSTRAINT "workflow_run_mutation_receipts_capability_check" CHECK ("workflow_run_mutation_receipts"."capability" in ('workflow_runs.start@1', 'workflow_runs.start@2'));--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_final_snapshot_digest_check" CHECK ("workflow_runs"."final_snapshot_digest" is null or "workflow_runs"."final_snapshot_digest" ~ '^sha256:[0-9a-f]{64}$');--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_final_snapshot_check" CHECK ((
        "workflow_runs"."final_snapshot" is null
          and "workflow_runs"."final_snapshot_digest" is null
      ) or (
        "workflow_runs"."final_snapshot" is not null
          and "workflow_runs"."final_snapshot_digest" is not null
          and jsonb_typeof("workflow_runs"."final_snapshot") = 'object'
          and "workflow_runs"."final_snapshot"->>'schema' = 'workflow-run-final-snapshot/v1'
          and "workflow_runs"."final_snapshot" ? 'runId'
          and "workflow_runs"."final_snapshot"->>'runId' = "workflow_runs"."id"
          and "workflow_runs"."final_snapshot" ? 'startSnapshotDigest'
          and "workflow_runs"."final_snapshot"->>'startSnapshotDigest' = "workflow_runs"."start_snapshot_digest"
          and jsonb_typeof("workflow_runs"."final_snapshot"->'stepAttempts') = 'array'
          and jsonb_typeof("workflow_runs"."final_snapshot"->'outputs') = 'object'
          and octet_length("workflow_runs"."final_snapshot"::text) <= 1048576
      ));--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_lifecycle_check" CHECK ((
        "workflow_runs"."state" = 'accepted'
          and "workflow_runs"."started_at" is null
          and "workflow_runs"."completed_at" is null
          and "workflow_runs"."output" is null
          and "workflow_runs"."final_snapshot" is null
          and "workflow_runs"."final_snapshot_digest" is null
          and "workflow_runs"."failure_code" is null
      ) or (
        "workflow_runs"."state" = 'running'
          and "workflow_runs"."started_at" is not null
          and "workflow_runs"."completed_at" is null
          and "workflow_runs"."output" is null
          and "workflow_runs"."final_snapshot" is null
          and "workflow_runs"."final_snapshot_digest" is null
          and "workflow_runs"."failure_code" is null
      ) or (
        "workflow_runs"."state" = 'completed'
          and "workflow_runs"."started_at" is not null
          and "workflow_runs"."completed_at" is not null
          and "workflow_runs"."output" is not null
          and "workflow_runs"."failure_code" is null
      ) or (
        "workflow_runs"."state" = 'failed'
          and "workflow_runs"."started_at" is not null
          and "workflow_runs"."completed_at" is not null
          and "workflow_runs"."output" is null
          and "workflow_runs"."final_snapshot" is null
          and "workflow_runs"."final_snapshot_digest" is null
          and "workflow_runs"."failure_code" is not null
      ));
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "workflow_run_event_insert_guard"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
	run_state text;
	next_sequence integer;
	previous_type text;
BEGIN
	SELECT "state", "next_event_sequence"
	INTO run_state, next_sequence
	FROM "workflow_runs"
	WHERE "workspace_id" = NEW.workspace_id
		AND "id" = NEW.run_id
	FOR UPDATE;
	IF NOT FOUND THEN
		RAISE EXCEPTION 'Workflow Run event has no canonical Run';
	END IF;
	IF run_state = 'accepted' THEN
		IF NEW.sequence <> 1 OR NEW.type <> 'run.accepted' THEN
			RAISE EXCEPTION 'Accepted Workflow Runs permit only the first accepted event';
		END IF;
		RETURN NEW;
	END IF;
	IF run_state <> 'running' THEN
		RAISE EXCEPTION 'Terminal Workflow Runs reject additional events';
	END IF;
	IF NEW.sequence < next_sequence THEN
		RAISE EXCEPTION 'Workflow Run event is behind the canonical cursor';
	END IF;
	IF NEW.sequence = next_sequence THEN
		IF NEW.type IN (
			'step.attempt.started',
			'artifact.generated',
			'step.attempt.completed',
			'step.attempt.failed',
			'step.completed',
			'run.failed'
		) THEN
			RETURN NEW;
		END IF;
		RAISE EXCEPTION 'Workflow Run event cannot begin this transition';
	END IF;
	SELECT "type"
	INTO previous_type
	FROM "workflow_run_events"
	WHERE "workspace_id" = NEW.workspace_id
		AND "run_id" = NEW.run_id
		AND "sequence" = NEW.sequence - 1;
	IF previous_type = 'artifact.generated'
		AND NEW.type IN ('artifact.generated', 'step.attempt.completed') THEN
		RETURN NEW;
	END IF;
	IF previous_type IN ('step.attempt.completed', 'step.completed')
		AND NEW.type = 'run.completed' THEN
		RETURN NEW;
	END IF;
	IF previous_type = 'step.attempt.failed'
		AND NEW.type = 'run.failed' THEN
		RETURN NEW;
	END IF;
	RAISE EXCEPTION 'Workflow Run event is out of sequence or invalid for the transition';
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "workflow_run_event_commit_guard"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
	run_state text;
	next_sequence integer;
BEGIN
	SELECT "state", "next_event_sequence"
	INTO run_state, next_sequence
	FROM "workflow_runs"
	WHERE "workspace_id" = NEW.workspace_id
		AND "id" = NEW.run_id;
	IF NEW.sequence = 1 AND NEW.type = 'run.accepted'
		AND next_sequence >= 2 THEN
		RETURN NULL;
	END IF;
	IF NEW.type = 'step.attempt.started'
		AND run_state IN ('running', 'completed')
		AND NEW.sequence < next_sequence
		AND EXISTS (
			SELECT 1 FROM "workflow_step_attempts"
			WHERE "workspace_id" = NEW.workspace_id
				AND "run_id" = NEW.run_id
				AND "id" = NEW.data->>'stepAttemptId'
		) THEN
		RETURN NULL;
	END IF;
	IF NEW.type = 'artifact.generated'
		AND run_state IN ('running', 'completed')
		AND NEW.sequence < next_sequence
		AND EXISTS (
			SELECT 1 FROM "artifact_generated_origins"
			WHERE "workspace_id" = NEW.workspace_id
				AND "run_id" = NEW.run_id
				AND "step_attempt_id" = NEW.data->>'stepAttemptId'
				AND "artifact_id" = NEW.data->>'artifactId'
				AND "output_name" = NEW.data->>'outputName'
		) THEN
		RETURN NULL;
	END IF;
	IF NEW.type = 'step.attempt.completed'
		AND run_state IN ('running', 'completed')
		AND NEW.sequence < next_sequence
		AND EXISTS (
			SELECT 1 FROM "workflow_step_attempts"
			WHERE "workspace_id" = NEW.workspace_id
				AND "run_id" = NEW.run_id
				AND "id" = NEW.data->>'stepAttemptId'
				AND "state" = 'completed'
		) THEN
		RETURN NULL;
	END IF;
	IF NEW.type = 'step.attempt.failed'
		AND run_state = 'failed'
		AND NEW.sequence < next_sequence
		AND EXISTS (
			SELECT 1 FROM "workflow_step_attempts"
			WHERE "workspace_id" = NEW.workspace_id
				AND "run_id" = NEW.run_id
				AND "id" = NEW.data->>'stepAttemptId'
				AND "state" = 'failed'
		) THEN
		RETURN NULL;
	END IF;
	IF NEW.type = 'step.completed'
		AND run_state = 'completed'
		AND next_sequence = NEW.sequence + 2
		AND EXISTS (
			SELECT 1 FROM "workflow_run_events"
			WHERE "workspace_id" = NEW.workspace_id
				AND "run_id" = NEW.run_id
				AND "sequence" = NEW.sequence + 1
				AND "type" = 'run.completed'
		) THEN
		RETURN NULL;
	END IF;
	IF NEW.type = 'run.completed'
		AND run_state = 'completed'
		AND next_sequence = NEW.sequence + 1
		AND EXISTS (
			SELECT 1 FROM "workflow_run_events"
			WHERE "workspace_id" = NEW.workspace_id
				AND "run_id" = NEW.run_id
				AND "sequence" = NEW.sequence - 1
				AND "type" IN ('step.completed', 'step.attempt.completed')
		) THEN
		RETURN NULL;
	END IF;
	IF NEW.type = 'run.failed'
		AND run_state = 'failed'
		AND next_sequence = NEW.sequence + 1 THEN
		RETURN NULL;
	END IF;
	RAISE EXCEPTION 'Workflow Run event is not part of a committed canonical transition';
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "workflow_run_acceptance_guard"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF NOT EXISTS (
		SELECT 1
		FROM "workflow_run_events"
		WHERE "workspace_id" = NEW.workspace_id
			AND "run_id" = NEW.id
			AND "sequence" = 1
			AND "type" = 'run.accepted'
	) OR NOT EXISTS (
		SELECT 1
		FROM "workflow_run_mutation_receipts"
		WHERE "workspace_id" = NEW.workspace_id
			AND "principal_id" = NEW.principal_id
			AND "capability" IN ('workflow_runs.start@1', 'workflow_runs.start@2')
			AND "run_id" = NEW.id
	) OR NOT EXISTS (
		SELECT 1
		FROM "workflow_run_outbox_intents"
		WHERE "workspace_id" = NEW.workspace_id
			AND "run_id" = NEW.id
	) THEN
		RAISE EXCEPTION 'Workflow Run acceptance must include its first event, receipt, and outbox intent';
	END IF;
	RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "workflow_run_identity_guard"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
	event_delta integer;
BEGIN
	IF TG_OP = 'DELETE' THEN
		RAISE EXCEPTION 'Workflow Runs cannot be deleted';
	END IF;
	IF (to_jsonb(NEW) - ARRAY[
			'state',
			'next_event_sequence',
			'output',
			'final_snapshot',
			'final_snapshot_digest',
			'failure_code',
			'started_at',
			'completed_at',
			'updated_at'
		]) <> (to_jsonb(OLD) - ARRAY[
			'state',
			'next_event_sequence',
			'output',
			'final_snapshot',
			'final_snapshot_digest',
			'failure_code',
			'started_at',
			'completed_at',
			'updated_at'
		]) THEN
		RAISE EXCEPTION 'Workflow Run start snapshot and provenance are immutable';
	END IF;
	event_delta := NEW.next_event_sequence - OLD.next_event_sequence;
	IF OLD.state = 'accepted' AND NEW.state = 'running' THEN
		IF event_delta <> 0 THEN
			RAISE EXCEPTION 'Starting a Workflow Run cannot append an event';
		END IF;
	ELSIF OLD.state = 'running' AND NEW.state = 'running' THEN
		IF event_delta = 1 AND EXISTS (
			SELECT 1 FROM "workflow_run_events"
			WHERE "workspace_id" = OLD.workspace_id
				AND "run_id" = OLD.id
				AND "sequence" = OLD.next_event_sequence
				AND "type" = 'step.attempt.started'
		) THEN
			NULL;
		ELSIF event_delta >= 1
			AND EXISTS (
				SELECT 1 FROM "workflow_run_events"
				WHERE "workspace_id" = OLD.workspace_id
					AND "run_id" = OLD.id
					AND "sequence" = NEW.next_event_sequence - 1
					AND "type" = 'step.attempt.completed'
			)
			AND NOT EXISTS (
				SELECT 1 FROM "workflow_run_events"
				WHERE "workspace_id" = OLD.workspace_id
					AND "run_id" = OLD.id
					AND "sequence" >= OLD.next_event_sequence
					AND "sequence" < NEW.next_event_sequence - 1
					AND "type" <> 'artifact.generated'
			) THEN
			NULL;
		ELSE
			RAISE EXCEPTION 'Running Workflow Run transition has invalid attempt events';
		END IF;
	ELSIF OLD.state = 'running' AND NEW.state = 'completed' THEN
		IF NEW.final_snapshot IS NOT NULL THEN
			IF event_delta < 2
				OR NOT EXISTS (
					SELECT 1 FROM "workflow_run_events"
					WHERE "workspace_id" = OLD.workspace_id
						AND "run_id" = OLD.id
						AND "sequence" = NEW.next_event_sequence - 2
						AND "type" = 'step.attempt.completed'
				)
				OR NOT EXISTS (
					SELECT 1 FROM "workflow_run_events"
					WHERE "workspace_id" = OLD.workspace_id
						AND "run_id" = OLD.id
						AND "sequence" = NEW.next_event_sequence - 1
						AND "type" = 'run.completed'
				)
				OR EXISTS (
					SELECT 1 FROM "workflow_run_events"
					WHERE "workspace_id" = OLD.workspace_id
						AND "run_id" = OLD.id
						AND "sequence" >= OLD.next_event_sequence
						AND "sequence" < NEW.next_event_sequence - 2
						AND "type" <> 'artifact.generated'
				) THEN
				RAISE EXCEPTION 'Golden Workflow Run completion events are missing or out of order';
			END IF;
		ELSIF event_delta <> 2
			OR NOT EXISTS (
				SELECT 1 FROM "workflow_run_events"
				WHERE "workspace_id" = OLD.workspace_id
					AND "run_id" = OLD.id
					AND "sequence" = OLD.next_event_sequence
					AND "type" = 'step.completed'
			)
			OR NOT EXISTS (
				SELECT 1 FROM "workflow_run_events"
				WHERE "workspace_id" = OLD.workspace_id
					AND "run_id" = OLD.id
					AND "sequence" = OLD.next_event_sequence + 1
					AND "type" = 'run.completed'
			) THEN
			RAISE EXCEPTION 'Workflow Run completion requires exactly two events';
		END IF;
	ELSIF OLD.state = 'running' AND NEW.state = 'failed' THEN
		IF event_delta = 1 AND EXISTS (
			SELECT 1 FROM "workflow_run_events"
			WHERE "workspace_id" = OLD.workspace_id
				AND "run_id" = OLD.id
				AND "sequence" = OLD.next_event_sequence
				AND "type" = 'run.failed'
		) THEN
			NULL;
		ELSIF event_delta = 2
			AND EXISTS (
				SELECT 1 FROM "workflow_run_events"
				WHERE "workspace_id" = OLD.workspace_id
					AND "run_id" = OLD.id
					AND "sequence" = OLD.next_event_sequence
					AND "type" = 'step.attempt.failed'
			)
			AND EXISTS (
				SELECT 1 FROM "workflow_run_events"
				WHERE "workspace_id" = OLD.workspace_id
					AND "run_id" = OLD.id
					AND "sequence" = OLD.next_event_sequence + 1
					AND "type" = 'run.failed'
			) THEN
			NULL;
		ELSE
			RAISE EXCEPTION 'Workflow Run failure events are missing or out of order';
		END IF;
	ELSE
		RAISE EXCEPTION 'Invalid Workflow Run state transition';
	END IF;
	IF NEW.updated_at < OLD.updated_at THEN
		RAISE EXCEPTION 'Workflow Run updated_at cannot move backward';
	END IF;
	RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION "workflow_step_attempt_identity_guard"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF TG_OP = 'DELETE' THEN
		RAISE EXCEPTION 'Workflow Step Attempts cannot be deleted';
	END IF;
	IF (to_jsonb(NEW) - ARRAY[
			'state',
			'outputs',
			'failure_code',
			'completed_at'
		]) <> (to_jsonb(OLD) - ARRAY[
			'state',
			'outputs',
			'failure_code',
			'completed_at'
		]) THEN
		RAISE EXCEPTION 'Workflow Step Attempt identity and Effect Key are immutable';
	END IF;
	IF OLD.state <> 'running' OR NEW.state NOT IN ('completed', 'failed') THEN
		RAISE EXCEPTION 'Invalid Workflow Step Attempt transition';
	END IF;
	RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "workflow_step_attempts_identity_immutable"
BEFORE UPDATE OR DELETE ON "workflow_step_attempts"
FOR EACH ROW EXECUTE FUNCTION "workflow_step_attempt_identity_guard"();
--> statement-breakpoint
CREATE TRIGGER "artifact_generated_origins_insert_only"
BEFORE UPDATE OR DELETE ON "artifact_generated_origins"
FOR EACH ROW EXECUTE FUNCTION "workflow_run_insert_only_guard"();
--> statement-breakpoint
CREATE TRIGGER "artifact_lineage_inputs_insert_only"
BEFORE UPDATE OR DELETE ON "artifact_lineage_inputs"
FOR EACH ROW EXECUTE FUNCTION "workflow_run_insert_only_guard"();
