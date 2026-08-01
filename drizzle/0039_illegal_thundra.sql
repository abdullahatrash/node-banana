ALTER TABLE "workflow_runs" DROP CONSTRAINT "workflow_runs_snapshot_check";--> statement-breakpoint
ALTER TABLE "workflow_step_attempts" ADD COLUMN "provider_adapter_module" text;--> statement-breakpoint
ALTER TABLE "workflow_step_attempts" ADD COLUMN "provider_adapter_contract_digest" text;--> statement-breakpoint
ALTER TABLE "workflow_step_attempts" ADD COLUMN "launch_safety" jsonb;--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_snapshot_check" CHECK (jsonb_typeof("workflow_runs"."start_snapshot") = 'object'
        and "workflow_runs"."start_snapshot"->>'schema' in ('workflow-run-start-snapshot/v1', 'workflow-run-start-snapshot/v2')
        and (
          "workflow_runs"."start_snapshot"->>'schema' <> 'workflow-run-start-snapshot/v2'
          or (
            jsonb_typeof("workflow_runs"."start_snapshot"->'providerResolutions') = 'array'
            and jsonb_array_length("workflow_runs"."start_snapshot"->'providerResolutions') > 0
          )
        )
        and "workflow_runs"."start_snapshot"->>'workflowId' = "workflow_runs"."workflow_id"
        and "workflow_runs"."start_snapshot"->>'workflowRevisionId' = "workflow_runs"."workflow_revision_id"
        and "workflow_runs"."start_snapshot"->'authorization'->>'principalId' = "workflow_runs"."principal_id"
        and "workflow_runs"."start_snapshot"->'authorization'->>'keyId' = "workflow_runs"."key_id"
        and "workflow_runs"."start_snapshot"->'authorization'->>'evidenceRef' = "workflow_runs"."authorization_evidence_ref"
        and octet_length("workflow_runs"."start_snapshot"::text) <= 1048576);--> statement-breakpoint
ALTER TABLE "workflow_step_attempts" ADD CONSTRAINT "workflow_step_attempts_adapter_identity_check" CHECK ((
        "workflow_step_attempts"."provider_adapter_module" is null
        and "workflow_step_attempts"."provider_adapter_contract_digest" is null
        and "workflow_step_attempts"."launch_safety" is null
      ) or (
        length("workflow_step_attempts"."provider_adapter_module") between 1 and 200
        and "workflow_step_attempts"."provider_adapter_contract_digest" ~ '^sha256:[0-9a-f]{64}$'
        and jsonb_typeof("workflow_step_attempts"."launch_safety") = 'object'
        and octet_length("workflow_step_attempts"."launch_safety"::text) <= 1024
      ));--> statement-breakpoint
CREATE OR REPLACE FUNCTION "workflow_step_attempt_identity_guard"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF TG_OP = 'DELETE' THEN
		RAISE EXCEPTION 'Workflow Step Attempts cannot be deleted';
	END IF;
	IF (to_jsonb(NEW) - ARRAY[
			'state', 'outputs', 'provider_operation_ref', 'provider_metadata',
			'outcome', 'reconciliation', 'failure_code', 'completed_at'
		]) <> (to_jsonb(OLD) - ARRAY[
			'state', 'outputs', 'provider_operation_ref', 'provider_metadata',
			'outcome', 'reconciliation', 'failure_code', 'completed_at'
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
