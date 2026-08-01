ALTER TABLE "workflow_run_events" DROP CONSTRAINT "workflow_run_events_type_check";--> statement-breakpoint
ALTER TABLE "workflow_run_mutation_receipts" DROP CONSTRAINT "workflow_run_mutation_receipts_capability_check";--> statement-breakpoint
ALTER TABLE "workflow_run_outbox_intents" DROP CONSTRAINT "workflow_run_outbox_intents_attempts_check";--> statement-breakpoint
ALTER TABLE "workflow_runs" DROP CONSTRAINT "workflow_runs_state_check";--> statement-breakpoint
ALTER TABLE "workflow_runs" DROP CONSTRAINT "workflow_runs_lifecycle_check";--> statement-breakpoint
ALTER TABLE "workflow_step_attempts" DROP CONSTRAINT "workflow_step_attempts_state_check";--> statement-breakpoint
ALTER TABLE "workflow_step_attempts" DROP CONSTRAINT "workflow_step_attempts_payload_check";--> statement-breakpoint
ALTER TABLE "workflow_step_attempts" DROP CONSTRAINT "workflow_step_attempts_lifecycle_check";--> statement-breakpoint
DROP INDEX "workflow_run_outbox_intents_workspace_run_unique";--> statement-breakpoint
DROP INDEX "workflow_step_attempts_workspace_effect_key_unique";--> statement-breakpoint
ALTER TABLE "workflow_run_mutation_receipts" ADD COLUMN "result" jsonb;--> statement-breakpoint
ALTER TABLE "workflow_run_outbox_intents" ADD COLUMN "generation" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD COLUMN "source_run_id" text;--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD COLUMN "root_run_id" text;--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD COLUMN "derivation_depth" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD COLUMN "derivation" jsonb;--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD COLUMN "resume_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "workflow_step_attempts" ADD COLUMN "provider_operation_ref" text;--> statement-breakpoint
ALTER TABLE "workflow_step_attempts" ADD COLUMN "outcome" jsonb;--> statement-breakpoint
ALTER TABLE "workflow_step_attempts" ADD COLUMN "reconciliation" jsonb;--> statement-breakpoint
CREATE OR REPLACE FUNCTION "workflow_step_attempt_identity_guard"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF TG_OP = 'DELETE' THEN
		RAISE EXCEPTION 'Workflow Step Attempts cannot be deleted';
	END IF;
	IF (to_jsonb(NEW) - ARRAY[
			'state', 'outputs', 'provider_operation_ref', 'outcome',
			'reconciliation', 'failure_code', 'completed_at'
		]) <> (to_jsonb(OLD) - ARRAY[
			'state', 'outputs', 'provider_operation_ref', 'outcome',
			'reconciliation', 'failure_code', 'completed_at'
		]) THEN
		RAISE EXCEPTION 'Workflow Step Attempt identity and Effect Key are immutable';
	END IF;
	IF OLD.state = NEW.state
		AND OLD.provider_operation_ref IS NULL
		AND OLD.outcome IS NULL
		AND NEW.outcome IS NOT NULL THEN
		RETURN NEW;
	END IF;
	IF OLD.state = 'running' AND NEW.state IN (
		'outcome_unknown', 'completed', 'failed'
	) THEN
		RETURN NEW;
	END IF;
	IF OLD.state = 'outcome_unknown' AND NEW.state IN (
		'completed', 'failed'
	) THEN
		RETURN NEW;
	END IF;
	RAISE EXCEPTION 'Invalid Workflow Step Attempt transition';
END;
$$;--> statement-breakpoint
UPDATE "workflow_step_attempts" AS attempt
SET
	"provider_operation_ref" = COALESCE(
		(
			SELECT origin."provider_operation_ref"
			FROM "artifact_generated_origins" AS origin
			WHERE origin."workspace_id" = attempt."workspace_id"
				AND origin."run_id" = attempt."run_id"
				AND origin."step_attempt_id" = attempt."id"
			ORDER BY origin."output_name"
			LIMIT 1
		),
		'legacy:' || attempt."id"
	),
	"outcome" = jsonb_build_object(
		'kind',
		'succeeded',
		'providerOperationRef',
		COALESCE(
			(
				SELECT origin."provider_operation_ref"
				FROM "artifact_generated_origins" AS origin
				WHERE origin."workspace_id" = attempt."workspace_id"
					AND origin."run_id" = attempt."run_id"
					AND origin."step_attempt_id" = attempt."id"
				ORDER BY origin."output_name"
				LIMIT 1
			),
			'legacy:' || attempt."id"
		)
	)
WHERE attempt."state" = 'completed';--> statement-breakpoint
UPDATE "workflow_step_attempts"
SET "outcome" = jsonb_build_object(
	'kind',
	'failed_known',
	'failureCode',
	"failure_code",
	'retryable',
	false
)
WHERE "state" = 'failed';--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_workspace_source_run_fk" FOREIGN KEY ("workspace_id","workflow_id","source_run_id") REFERENCES "public"."workflow_runs"("workspace_id","workflow_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_workspace_root_run_fk" FOREIGN KEY ("workspace_id","workflow_id","root_run_id") REFERENCES "public"."workflow_runs"("workspace_id","workflow_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_run_outbox_intents_workspace_run_generation_unique" ON "workflow_run_outbox_intents" USING btree ("workspace_id","run_id","generation");--> statement-breakpoint
CREATE INDEX "workflow_step_attempts_workspace_effect_key_idx" ON "workflow_step_attempts" USING btree ("workspace_id","effect_key");--> statement-breakpoint
ALTER TABLE "workflow_run_events" ADD CONSTRAINT "workflow_run_events_type_check" CHECK ("workflow_run_events"."type" in (
        'run.accepted',
        'run.derived',
        'step.attempt.started',
        'artifact.generated',
        'step.attempt.completed',
        'step.attempt.failed',
        'step.retry.scheduled',
        'step.attempt.outcome_unknown',
        'step.attempt.reconciled',
        'run.waiting',
        'run.resumed',
        'run.outcome_unknown',
        'step.completed',
        'run.completed',
        'run.failed'
      ));--> statement-breakpoint
ALTER TABLE "workflow_run_mutation_receipts" ADD CONSTRAINT "workflow_run_mutation_receipts_result_check" CHECK ((
        "workflow_run_mutation_receipts"."capability" in (
          'workflow_runs.start@1',
          'workflow_runs.start@2'
        )
        and "workflow_run_mutation_receipts"."result" is null
      ) or (
        "workflow_run_mutation_receipts"."capability" in (
          'workflow_runs.retry@1',
          'workflow_runs.reconcile@1',
          'workflow_runs.resume@1'
        )
        and jsonb_typeof("workflow_run_mutation_receipts"."result") = 'object'
        and "workflow_run_mutation_receipts"."result"->'run'->>'id' = "workflow_run_mutation_receipts"."run_id"
        and "workflow_run_mutation_receipts"."result"->'inspect'->>'capability' = 'workflow_runs.get@1'
        and "workflow_run_mutation_receipts"."result"->'inspect'->'input'->>'runId' = "workflow_run_mutation_receipts"."run_id"
        and "workflow_run_mutation_receipts"."result"->'events'->>'capability' = 'workflow_run_events.list@1'
        and "workflow_run_mutation_receipts"."result"->'events'->'input'->>'runId' = "workflow_run_mutation_receipts"."run_id"
        and "workflow_run_mutation_receipts"."result"->'events'->'input'->>'cursor' = "workflow_run_mutation_receipts"."initial_event_cursor"
        and octet_length("workflow_run_mutation_receipts"."result"::text) <= 2097152
      ));--> statement-breakpoint
ALTER TABLE "workflow_run_mutation_receipts" ADD CONSTRAINT "workflow_run_mutation_receipts_capability_check" CHECK ("workflow_run_mutation_receipts"."capability" in (
        'workflow_runs.start@1',
        'workflow_runs.start@2',
        'workflow_runs.retry@1',
        'workflow_runs.reconcile@1',
        'workflow_runs.resume@1'
      ));--> statement-breakpoint
ALTER TABLE "workflow_run_outbox_intents" ADD CONSTRAINT "workflow_run_outbox_intents_attempts_check" CHECK ("workflow_run_outbox_intents"."delivery_attempts" >= 0 and "workflow_run_outbox_intents"."generation" > 0);--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_derivation_check" CHECK ((
        "workflow_runs"."source_run_id" is null
          and "workflow_runs"."root_run_id" is null
          and "workflow_runs"."derivation_depth" = 0
          and "workflow_runs"."derivation" is null
      ) or (
        "workflow_runs"."source_run_id" is not null
          and "workflow_runs"."root_run_id" is not null
          and "workflow_runs"."derivation_depth" > 0
          and "workflow_runs"."derivation_depth" <= 100
          and jsonb_typeof("workflow_runs"."derivation") = 'object'
          and "workflow_runs"."derivation"->>'kind' = 'manual_retry'
          and "workflow_runs"."derivation"->>'sourceRunId' = "workflow_runs"."source_run_id"
          and "workflow_runs"."derivation"->>'rootRunId' = "workflow_runs"."root_run_id"
          and "workflow_runs"."derivation"->>'sourceStartSnapshotDigest' ~ '^sha256:[0-9a-f]{64}$'
          and length("workflow_runs"."derivation"->>'retryFromStepId') between 1 and 200
          and jsonb_typeof("workflow_runs"."derivation"->'reusedOutputs') = 'array'
          and octet_length("workflow_runs"."derivation"::text) <= 262144
      ));--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_state_check" CHECK ("workflow_runs"."state" in ('accepted', 'running', 'waiting', 'outcome_unknown', 'completed', 'failed'));--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_lifecycle_check" CHECK ((
        "workflow_runs"."state" = 'accepted'
          and "workflow_runs"."started_at" is null
          and "workflow_runs"."completed_at" is null
          and "workflow_runs"."output" is null
          and "workflow_runs"."final_snapshot" is null
          and "workflow_runs"."final_snapshot_digest" is null
          and "workflow_runs"."resume_at" is null
          and "workflow_runs"."failure_code" is null
      ) or (
        "workflow_runs"."state" = 'running'
          and "workflow_runs"."started_at" is not null
          and "workflow_runs"."completed_at" is null
          and "workflow_runs"."output" is null
          and "workflow_runs"."final_snapshot" is null
          and "workflow_runs"."final_snapshot_digest" is null
          and "workflow_runs"."resume_at" is null
          and "workflow_runs"."failure_code" is null
      ) or (
        "workflow_runs"."state" = 'waiting'
          and "workflow_runs"."started_at" is not null
          and "workflow_runs"."completed_at" is null
          and "workflow_runs"."output" is null
          and "workflow_runs"."final_snapshot" is null
          and "workflow_runs"."final_snapshot_digest" is null
          and "workflow_runs"."resume_at" is not null
          and "workflow_runs"."failure_code" is not null
      ) or (
        "workflow_runs"."state" = 'outcome_unknown'
          and "workflow_runs"."started_at" is not null
          and "workflow_runs"."completed_at" is null
          and "workflow_runs"."output" is null
          and "workflow_runs"."final_snapshot" is null
          and "workflow_runs"."final_snapshot_digest" is null
          and "workflow_runs"."resume_at" is null
          and "workflow_runs"."failure_code" is not null
      ) or (
        "workflow_runs"."state" = 'completed'
          and "workflow_runs"."started_at" is not null
          and "workflow_runs"."completed_at" is not null
          and "workflow_runs"."output" is not null
          and "workflow_runs"."resume_at" is null
          and "workflow_runs"."failure_code" is null
      ) or (
        "workflow_runs"."state" = 'failed'
          and "workflow_runs"."started_at" is not null
          and "workflow_runs"."completed_at" is not null
          and "workflow_runs"."output" is null
          and "workflow_runs"."final_snapshot" is null
          and "workflow_runs"."final_snapshot_digest" is null
          and "workflow_runs"."resume_at" is null
          and "workflow_runs"."failure_code" is not null
      ));--> statement-breakpoint
ALTER TABLE "workflow_step_attempts" ADD CONSTRAINT "workflow_step_attempts_state_check" CHECK ("workflow_step_attempts"."state" in ('running', 'outcome_unknown', 'completed', 'failed'));--> statement-breakpoint
ALTER TABLE "workflow_step_attempts" ADD CONSTRAINT "workflow_step_attempts_payload_check" CHECK (jsonb_typeof("workflow_step_attempts"."inputs") = 'array'
        and octet_length("workflow_step_attempts"."inputs"::text) <= 262144
        and (
          "workflow_step_attempts"."outputs" is null
          or (
            jsonb_typeof("workflow_step_attempts"."outputs") = 'object'
            and octet_length("workflow_step_attempts"."outputs"::text) <= 262144
          )
        )
        and (
          "workflow_step_attempts"."outcome" is null
          or (
            jsonb_typeof("workflow_step_attempts"."outcome") = 'object'
            and octet_length("workflow_step_attempts"."outcome"::text) <= 4096
          )
        )
        and (
          "workflow_step_attempts"."reconciliation" is null
          or (
            jsonb_typeof("workflow_step_attempts"."reconciliation") = 'object'
            and octet_length("workflow_step_attempts"."reconciliation"::text) <= 4096
          )
        ));--> statement-breakpoint
ALTER TABLE "workflow_step_attempts" ADD CONSTRAINT "workflow_step_attempts_provider_evidence_check" CHECK ("workflow_step_attempts"."provider_operation_ref" is null or (
        length("workflow_step_attempts"."provider_operation_ref") between 1 and 500
        and "workflow_step_attempts"."provider_operation_ref" = btrim("workflow_step_attempts"."provider_operation_ref")
        and "workflow_step_attempts"."provider_operation_ref" !~ '[[:cntrl:]]'
      ));--> statement-breakpoint
ALTER TABLE "workflow_step_attempts" ADD CONSTRAINT "workflow_step_attempts_lifecycle_check" CHECK ((
        "workflow_step_attempts"."state" = 'running'
          and "workflow_step_attempts"."outputs" is null
          and (
            (
              "workflow_step_attempts"."provider_operation_ref" is null
              and "workflow_step_attempts"."outcome" is null
            ) or (
              "workflow_step_attempts"."provider_operation_ref" is not null
              and "workflow_step_attempts"."outcome"->>'kind' = 'succeeded'
              and "workflow_step_attempts"."outcome"->>'providerOperationRef' = "workflow_step_attempts"."provider_operation_ref"
            )
          )
          and "workflow_step_attempts"."reconciliation" is null
          and "workflow_step_attempts"."failure_code" is null
          and "workflow_step_attempts"."completed_at" is null
      ) or (
        "workflow_step_attempts"."state" = 'completed'
          and "workflow_step_attempts"."outputs" is not null
          and "workflow_step_attempts"."provider_operation_ref" is not null
          and "workflow_step_attempts"."outcome"->>'kind' = 'succeeded'
          and "workflow_step_attempts"."outcome"->>'providerOperationRef' = "workflow_step_attempts"."provider_operation_ref"
          and "workflow_step_attempts"."failure_code" is null
          and "workflow_step_attempts"."completed_at" is not null
          and "workflow_step_attempts"."completed_at" >= "workflow_step_attempts"."started_at"
      ) or (
        "workflow_step_attempts"."state" = 'failed'
          and "workflow_step_attempts"."outputs" is null
          and "workflow_step_attempts"."outcome"->>'kind' = 'failed_known'
          and "workflow_step_attempts"."failure_code" is not null
          and "workflow_step_attempts"."outcome"->>'failureCode' = "workflow_step_attempts"."failure_code"
          and jsonb_typeof("workflow_step_attempts"."outcome"->'retryable') = 'boolean'
          and "workflow_step_attempts"."completed_at" is not null
          and "workflow_step_attempts"."completed_at" >= "workflow_step_attempts"."started_at"
      ) or (
        "workflow_step_attempts"."state" = 'outcome_unknown'
          and "workflow_step_attempts"."outputs" is null
          and "workflow_step_attempts"."outcome"->>'kind' = 'outcome_unknown'
          and "workflow_step_attempts"."failure_code" is not null
          and "workflow_step_attempts"."outcome"->>'failureCode' = "workflow_step_attempts"."failure_code"
          and "workflow_step_attempts"."outcome" ? 'priorSucceededProviderOperationRef'
          and jsonb_typeof("workflow_step_attempts"."outcome"->'priorSucceededProviderOperationRef') in ('string', 'null')
          and (
            "workflow_step_attempts"."outcome"->>'priorSucceededProviderOperationRef' is null
            or (
              "workflow_step_attempts"."provider_operation_ref" is not null
              and "workflow_step_attempts"."outcome"->>'priorSucceededProviderOperationRef' = "workflow_step_attempts"."provider_operation_ref"
            )
          )
          and "workflow_step_attempts"."completed_at" is null
      ));
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "workflow_run_event_insert_guard"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
	run_state text;
	next_sequence integer;
	previous_sequence integer;
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
	IF run_state IN ('completed', 'failed') THEN
		RAISE EXCEPTION 'Terminal Workflow Runs reject additional events';
	END IF;
	SELECT coalesce(max("sequence"), 0)
	INTO previous_sequence
	FROM "workflow_run_events"
	WHERE "workspace_id" = NEW.workspace_id
		AND "run_id" = NEW.run_id;
	IF NEW.sequence <> previous_sequence + 1 THEN
		RAISE EXCEPTION 'Workflow Run events must be inserted in gap-free order';
	END IF;
	IF NEW.type = 'run.accepted' AND NEW.sequence <> 1 THEN
		RAISE EXCEPTION 'run.accepted must be the first event';
	ELSIF NEW.type = 'run.derived' AND (
		NEW.sequence <> 2 OR NOT EXISTS (
			SELECT 1 FROM "workflow_runs"
			WHERE "workspace_id" = NEW.workspace_id
				AND "id" = NEW.run_id
				AND "source_run_id" IS NOT NULL
		)
	) THEN
		RAISE EXCEPTION 'run.derived must be the second event of a derived Run';
	ELSIF NEW.sequence = 1 AND NEW.type <> 'run.accepted' THEN
		RAISE EXCEPTION 'Workflow Run event streams must begin with run.accepted';
	ELSIF NEW.sequence > 1 AND NEW.type = 'run.accepted' THEN
		RAISE EXCEPTION 'Workflow Run event streams contain one run.accepted event';
	END IF;
	RETURN NEW;
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
	event_count integer;
	previous_type text;
	next_type text;
BEGIN
	SELECT "state", "next_event_sequence"
	INTO run_state, next_sequence
	FROM "workflow_runs"
	WHERE "workspace_id" = NEW.workspace_id
		AND "id" = NEW.run_id;
	IF NEW.sequence >= next_sequence THEN
		RAISE EXCEPTION 'Workflow Run event is not committed by the canonical cursor';
	END IF;
	SELECT count(*) INTO event_count
	FROM "workflow_run_events"
	WHERE "workspace_id" = NEW.workspace_id
		AND "run_id" = NEW.run_id
		AND "sequence" >= 1
		AND "sequence" < next_sequence;
	IF event_count <> next_sequence - 1 THEN
		RAISE EXCEPTION 'Workflow Run event stream contains a gap';
	END IF;
	SELECT "type" INTO previous_type
	FROM "workflow_run_events"
	WHERE "workspace_id" = NEW.workspace_id
		AND "run_id" = NEW.run_id
		AND "sequence" = NEW.sequence - 1;
	SELECT "type" INTO next_type
	FROM "workflow_run_events"
	WHERE "workspace_id" = NEW.workspace_id
		AND "run_id" = NEW.run_id
		AND "sequence" = NEW.sequence + 1;
	IF NEW.sequence = 1 AND NEW.type <> 'run.accepted' THEN
		RAISE EXCEPTION 'Workflow Run event streams must begin with run.accepted';
	ELSIF NEW.type = 'run.accepted' AND NEW.sequence <> 1 THEN
		RAISE EXCEPTION 'run.accepted may occur only once';
	ELSIF NEW.type = 'run.derived' AND (
		NEW.sequence <> 2 OR previous_type <> 'run.accepted'
	) THEN
		RAISE EXCEPTION 'run.derived has an invalid canonical position';
	ELSIF previous_type IS NOT NULL AND NOT (
		(previous_type = 'run.accepted' AND NEW.type IN (
			'run.derived', 'step.attempt.started', 'step.completed', 'run.failed'
		)) OR
		(previous_type = 'run.derived' AND NEW.type IN (
			'step.attempt.started', 'step.completed', 'run.failed'
		)) OR
		(previous_type = 'step.attempt.started' AND NEW.type IN (
			'artifact.generated', 'step.attempt.completed',
			'step.attempt.failed', 'step.attempt.outcome_unknown'
		)) OR
		(previous_type = 'artifact.generated' AND NEW.type IN (
			'artifact.generated', 'step.attempt.completed',
			'step.attempt.reconciled'
		)) OR
		(previous_type = 'step.attempt.completed' AND NEW.type IN (
			'step.attempt.started', 'run.waiting', 'run.completed'
		)) OR
		(previous_type = 'step.attempt.failed' AND NEW.type IN (
			'step.retry.scheduled', 'run.failed'
		)) OR
		(previous_type = 'step.retry.scheduled' AND NEW.type = 'run.waiting') OR
		(previous_type = 'run.waiting' AND NEW.type = 'run.resumed') OR
		(previous_type = 'run.resumed' AND NEW.type = 'step.attempt.started') OR
		(previous_type = 'step.attempt.outcome_unknown'
			AND NEW.type = 'run.outcome_unknown') OR
		(previous_type = 'run.outcome_unknown'
			AND NEW.type IN ('artifact.generated', 'step.attempt.reconciled')) OR
		(previous_type = 'step.attempt.reconciled'
			AND NEW.type IN ('step.attempt.completed', 'step.attempt.failed')) OR
		(previous_type = 'step.completed' AND NEW.type = 'run.completed')
	) THEN
		RAISE EXCEPTION 'Workflow Run event stream has an invalid canonical transition';
	END IF;
	IF next_type IS NULL AND NOT (
		(run_state = 'accepted' AND NEW.type IN ('run.accepted', 'run.derived')) OR
		(run_state = 'running' AND NEW.type IN (
			'run.accepted', 'run.derived', 'run.resumed',
			'step.attempt.started', 'step.attempt.completed'
		)) OR
		(run_state = 'waiting' AND NEW.type = 'run.waiting') OR
		(run_state = 'outcome_unknown' AND NEW.type = 'run.outcome_unknown') OR
		(run_state = 'completed' AND NEW.type = 'run.completed') OR
		(run_state = 'failed' AND NEW.type = 'run.failed')
	) THEN
		RAISE EXCEPTION 'Workflow Run state does not match its final event';
	END IF;
	IF NEW.type = 'step.attempt.completed' AND NOT EXISTS (
		SELECT 1 FROM "workflow_step_attempts"
		WHERE "workspace_id" = NEW.workspace_id
			AND "run_id" = NEW.run_id
			AND "id" = NEW.data->>'stepAttemptId'
			AND "step_id" = NEW.data->>'stepId'
			AND "attempt"::text = NEW.data->>'attempt'
			AND "effect_key" = NEW.data->>'effectKey'
			AND "state" = 'completed'
			AND jsonb_typeof(NEW.data->'outputArtifactIds') = 'array'
			AND jsonb_array_length(NEW.data->'outputArtifactIds') = jsonb_object_length("outputs")
			AND NOT EXISTS (
				SELECT 1
				FROM jsonb_each("outputs") AS output("output_name", "value")
				WHERE NOT (NEW.data->'outputArtifactIds' ? (output.value->>'artifactId'))
			)
	) THEN
		RAISE EXCEPTION 'Completed Step Attempt event has no completed Attempt';
	ELSIF NEW.type = 'step.attempt.started' AND NOT EXISTS (
		SELECT 1 FROM "workflow_step_attempts"
		WHERE "workspace_id" = NEW.workspace_id
			AND "run_id" = NEW.run_id
			AND "id" = NEW.data->>'stepAttemptId'
			AND "step_id" = NEW.data->>'stepId'
			AND "attempt"::text = NEW.data->>'attempt'
			AND "effect_key" = NEW.data->>'effectKey'
			AND "operation_identity" = NEW.data->>'operationIdentity'
			AND "intent_digest" = NEW.data->>'intentDigest'
			AND "state" = 'running'
	) THEN
		RAISE EXCEPTION 'Started Step Attempt event has no running Attempt';
	ELSIF NEW.type = 'artifact.generated' AND NOT EXISTS (
		SELECT 1 FROM "workflow_step_attempts"
		WHERE "workspace_id" = NEW.workspace_id
			AND "run_id" = NEW.run_id
			AND "id" = NEW.data->>'stepAttemptId'
			AND "step_id" = NEW.data->>'stepId'
			AND "state" = 'completed'
			AND EXISTS (
				SELECT 1
				FROM jsonb_each("outputs") AS output("output_name", "value")
				WHERE output.output_name = NEW.data->>'outputName'
					AND output.value->>'artifactId' = NEW.data->>'artifactId'
					AND output.value->>'digest' = NEW.data->>'digest'
			)
	) THEN
		RAISE EXCEPTION 'Generated Artifact event has no completed Attempt output';
	ELSIF NEW.type = 'step.attempt.reconciled' AND NOT EXISTS (
		SELECT 1 FROM "workflow_step_attempts"
		WHERE "workspace_id" = NEW.workspace_id
			AND "run_id" = NEW.run_id
			AND "id" = NEW.data->>'stepAttemptId'
			AND "reconciliation" IS NOT NULL
			AND "reconciliation"->>'resolution' = NEW.data->>'resolution'
	) THEN
		RAISE EXCEPTION 'Reconciled Step Attempt event has no reconciliation evidence';
	ELSIF NEW.type = 'step.attempt.failed' AND NOT EXISTS (
		SELECT 1 FROM "workflow_step_attempts"
		WHERE "workspace_id" = NEW.workspace_id
			AND "run_id" = NEW.run_id
			AND "id" = NEW.data->>'stepAttemptId'
			AND "step_id" = NEW.data->>'stepId'
			AND "attempt"::text = NEW.data->>'attempt'
			AND "effect_key" = NEW.data->>'effectKey'
			AND "state" = 'failed'
			AND "failure_code" = NEW.data->>'reasonCode'
	) THEN
		RAISE EXCEPTION 'Failed Step Attempt event has no failed Attempt';
	ELSIF NEW.type = 'step.retry.scheduled' AND NOT EXISTS (
		SELECT 1 FROM "workflow_step_attempts"
		WHERE "workspace_id" = NEW.workspace_id
			AND "run_id" = NEW.run_id
			AND "id" = NEW.data->>'stepAttemptId'
			AND "step_id" = NEW.data->>'stepId'
			AND "attempt"::text = NEW.data->>'attempt'
			AND "effect_key" = NEW.data->>'effectKey'
			AND "state" = 'failed'
			AND "outcome"->>'retryable' = 'true'
			AND ("attempt" + 1)::text = NEW.data->>'nextAttempt'
			AND EXISTS (
				SELECT 1 FROM "workflow_runs"
				WHERE "workspace_id" = NEW.workspace_id
					AND "id" = NEW.run_id
					AND "resume_at" = (NEW.data->>'retryAt')::timestamptz
			)
	) THEN
		RAISE EXCEPTION 'Scheduled retry event has no retryable failed Attempt';
	ELSIF NEW.type = 'step.attempt.outcome_unknown' AND NOT EXISTS (
		SELECT 1 FROM "workflow_step_attempts"
		WHERE "workspace_id" = NEW.workspace_id
			AND "run_id" = NEW.run_id
			AND "id" = NEW.data->>'stepAttemptId'
			AND "step_id" = NEW.data->>'stepId'
			AND "attempt"::text = NEW.data->>'attempt'
			AND "effect_key" = NEW.data->>'effectKey'
			AND "state" = 'outcome_unknown'
			AND "failure_code" = NEW.data->>'reasonCode'
	) THEN
		RAISE EXCEPTION 'Unknown Step Attempt event has no unknown Attempt';
	END IF;
	RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "workflow_run_acceptance_guard"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM "workflow_run_events"
		WHERE "workspace_id" = NEW.workspace_id
			AND "run_id" = NEW.id
			AND "sequence" = 1
			AND "type" = 'run.accepted'
	) OR NOT EXISTS (
		SELECT 1 FROM "workflow_run_mutation_receipts"
		WHERE "workspace_id" = NEW.workspace_id
			AND "principal_id" = NEW.principal_id
			AND "capability" IN (
				'workflow_runs.start@1',
				'workflow_runs.start@2',
				'workflow_runs.retry@1'
			)
			AND "run_id" = NEW.id
	) OR NOT EXISTS (
		SELECT 1 FROM "workflow_run_outbox_intents"
		WHERE "workspace_id" = NEW.workspace_id
			AND "run_id" = NEW.id
			AND "generation" = 1
	) THEN
		RAISE EXCEPTION 'Workflow Run acceptance must include its first event, receipt, and first outbox intent';
	END IF;
	IF NEW.source_run_id IS NOT NULL AND NOT EXISTS (
		SELECT 1 FROM "workflow_run_events"
		WHERE "workspace_id" = NEW.workspace_id
			AND "run_id" = NEW.id
			AND "sequence" = 2
			AND "type" = 'run.derived'
	) THEN
		RAISE EXCEPTION 'Derived Workflow Run acceptance requires its derivation event';
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
	event_types text[];
	prefix_is_artifacts boolean;
BEGIN
	IF TG_OP = 'DELETE' THEN
		RAISE EXCEPTION 'Workflow Runs cannot be deleted';
	END IF;
	IF (to_jsonb(NEW) - ARRAY[
			'state', 'next_event_sequence', 'output', 'final_snapshot',
			'final_snapshot_digest', 'resume_at', 'failure_code',
			'started_at', 'completed_at', 'updated_at'
		]) <> (to_jsonb(OLD) - ARRAY[
			'state', 'next_event_sequence', 'output', 'final_snapshot',
			'final_snapshot_digest', 'resume_at', 'failure_code',
			'started_at', 'completed_at', 'updated_at'
		]) THEN
		RAISE EXCEPTION 'Workflow Run start snapshot, derivation, and provenance are immutable';
	END IF;
	event_delta := NEW.next_event_sequence - OLD.next_event_sequence;
	IF event_delta < 0 THEN
		RAISE EXCEPTION 'Workflow Run event cursor cannot move backward';
	END IF;
	SELECT coalesce(array_agg("type" ORDER BY "sequence"), ARRAY[]::text[])
	INTO event_types
	FROM "workflow_run_events"
	WHERE "workspace_id" = NEW.workspace_id
		AND "run_id" = NEW.id
		AND "sequence" >= OLD.next_event_sequence
		AND "sequence" < NEW.next_event_sequence;
	IF cardinality(event_types) <> event_delta THEN
		RAISE EXCEPTION 'Workflow Run transition events are incomplete';
	END IF;
	IF OLD.state = 'accepted' AND NEW.state = 'running' AND event_delta = 0 THEN
		NULL;
	ELSIF OLD.state = 'waiting' AND NEW.state = 'running'
		AND event_types = ARRAY['run.resumed'] THEN
		NULL;
	ELSIF OLD.state = 'running' AND NEW.state = 'running'
		AND event_types = ARRAY['step.attempt.started'] THEN
		NULL;
	ELSIF OLD.state = 'running' AND NEW.state = 'running'
		AND event_delta >= 1
		AND event_types[event_delta] = 'step.attempt.completed' THEN
		SELECT coalesce(bool_and("type" = 'artifact.generated'), true)
		INTO prefix_is_artifacts
		FROM "workflow_run_events"
		WHERE "workspace_id" = NEW.workspace_id
			AND "run_id" = NEW.id
			AND "sequence" >= OLD.next_event_sequence
			AND "sequence" < NEW.next_event_sequence - 1;
		IF NOT prefix_is_artifacts THEN
			RAISE EXCEPTION 'Running settlement requires generated Artifacts followed by completion';
		END IF;
	ELSIF OLD.state = 'running' AND NEW.state = 'waiting'
		AND event_types = ARRAY[
			'step.attempt.failed', 'step.retry.scheduled', 'run.waiting'
		] THEN
		NULL;
	ELSIF OLD.state = 'running' AND NEW.state = 'outcome_unknown'
		AND event_types = ARRAY[
			'step.attempt.outcome_unknown', 'run.outcome_unknown'
		] THEN
		NULL;
	ELSIF OLD.state = 'running' AND NEW.state = 'completed'
		AND event_types = ARRAY['step.completed', 'run.completed'] THEN
		NULL;
	ELSIF OLD.state = 'running' AND NEW.state = 'completed'
		AND event_delta >= 2
		AND event_types[event_delta - 1] = 'step.attempt.completed'
		AND event_types[event_delta] = 'run.completed' THEN
		SELECT coalesce(bool_and("type" = 'artifact.generated'), true)
		INTO prefix_is_artifacts
		FROM "workflow_run_events"
		WHERE "workspace_id" = NEW.workspace_id
			AND "run_id" = NEW.id
			AND "sequence" >= OLD.next_event_sequence
			AND "sequence" < NEW.next_event_sequence - 2;
		IF NOT prefix_is_artifacts THEN
			RAISE EXCEPTION 'Completion requires generated Artifacts followed by canonical completion events';
		END IF;
	ELSIF OLD.state = 'running' AND NEW.state = 'failed'
		AND event_types IN (
			ARRAY['run.failed'],
			ARRAY['step.attempt.failed', 'run.failed']
		) THEN
		NULL;
	ELSIF OLD.state = 'outcome_unknown'
		AND NEW.state IN ('waiting', 'completed')
		AND event_delta >= 3
		AND event_types[event_delta - 2] = 'step.attempt.reconciled'
		AND event_types[event_delta - 1] = 'step.attempt.completed'
		AND event_types[event_delta] = CASE
			WHEN NEW.state = 'waiting' THEN 'run.waiting'
			ELSE 'run.completed'
		END THEN
		SELECT coalesce(bool_and("type" = 'artifact.generated'), true)
		INTO prefix_is_artifacts
		FROM "workflow_run_events"
		WHERE "workspace_id" = NEW.workspace_id
			AND "run_id" = NEW.id
			AND "sequence" >= OLD.next_event_sequence
			AND "sequence" < NEW.next_event_sequence - 3;
		IF NOT prefix_is_artifacts THEN
			RAISE EXCEPTION 'Reconciliation requires generated Artifacts followed by canonical resolution events';
		END IF;
	ELSIF OLD.state = 'outcome_unknown' AND NEW.state = 'waiting'
		AND event_types = ARRAY[
			'step.attempt.reconciled', 'step.attempt.failed',
			'step.retry.scheduled', 'run.waiting'
		] THEN
		NULL;
	ELSIF OLD.state = 'outcome_unknown' AND NEW.state = 'failed'
		AND event_types = ARRAY[
			'step.attempt.reconciled', 'step.attempt.failed', 'run.failed'
		] THEN
		NULL;
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
CREATE OR REPLACE FUNCTION "workflow_step_attempt_identity_guard"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF TG_OP = 'DELETE' THEN
		RAISE EXCEPTION 'Workflow Step Attempts cannot be deleted';
	END IF;
	IF (to_jsonb(NEW) - ARRAY[
			'state', 'outputs', 'provider_operation_ref', 'outcome',
			'reconciliation', 'failure_code', 'completed_at'
		]) <> (to_jsonb(OLD) - ARRAY[
			'state', 'outputs', 'provider_operation_ref', 'outcome',
			'reconciliation', 'failure_code', 'completed_at'
		]) THEN
		RAISE EXCEPTION 'Workflow Step Attempt identity and Effect Key are immutable';
	END IF;
	IF OLD.state = 'running' AND NEW.state IN (
		'outcome_unknown', 'completed', 'failed'
	) THEN
		RETURN NEW;
	END IF;
	IF OLD.state = 'running' AND NEW.state = 'running'
		AND OLD.provider_operation_ref IS NULL
		AND OLD.outcome IS NULL
		AND NEW.provider_operation_ref IS NOT NULL
		AND NEW.outcome->>'kind' = 'succeeded'
		AND NEW.outcome->>'providerOperationRef' = NEW.provider_operation_ref THEN
		RETURN NEW;
	END IF;
	IF OLD.state = 'outcome_unknown'
		AND OLD.outcome->>'priorSucceededProviderOperationRef' IS NOT NULL THEN
		IF NEW.state = 'completed'
			AND NEW.provider_operation_ref = OLD.outcome->>'priorSucceededProviderOperationRef'
			AND NEW.outcome->>'kind' = 'succeeded'
			AND NEW.outcome->>'providerOperationRef' = OLD.outcome->>'priorSucceededProviderOperationRef' THEN
			RETURN NEW;
		END IF;
		RAISE EXCEPTION 'Durable provider success evidence cannot be contradicted';
	END IF;
	IF OLD.state = 'outcome_unknown' AND NEW.state IN (
		'completed', 'failed'
	) THEN
		RETURN NEW;
	END IF;
	RAISE EXCEPTION 'Invalid Workflow Step Attempt transition';
END;
$$;
