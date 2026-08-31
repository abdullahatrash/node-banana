ALTER TABLE "workflow_runs" DROP CONSTRAINT "workflow_runs_snapshot_check";--> statement-breakpoint
ALTER TABLE "workflow_step_attempts" ADD COLUMN "provider_metadata" jsonb;--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_snapshot_check" CHECK (jsonb_typeof("workflow_runs"."start_snapshot") = 'object'
        and "workflow_runs"."start_snapshot"->>'schema' in ('workflow-run-start-snapshot/v1', 'workflow-run-start-snapshot/v2')
        and "workflow_runs"."start_snapshot"->>'workflowId' = "workflow_runs"."workflow_id"
        and "workflow_runs"."start_snapshot"->>'workflowRevisionId' = "workflow_runs"."workflow_revision_id"
        and "workflow_runs"."start_snapshot"->'authorization'->>'principalId' = "workflow_runs"."principal_id"
        and "workflow_runs"."start_snapshot"->'authorization'->>'keyId' = "workflow_runs"."key_id"
        and "workflow_runs"."start_snapshot"->'authorization'->>'evidenceRef' = "workflow_runs"."authorization_evidence_ref"
        and octet_length("workflow_runs"."start_snapshot"::text) <= 1048576);