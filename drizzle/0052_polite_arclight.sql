CREATE TYPE "public"."byok_provider" AS ENUM('gemini', 'openai', 'anthropic', 'kie', 'fal', 'replicate', 'wavespeed');--> statement-breakpoint
CREATE TABLE "api_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"name" text NOT NULL,
	"token_hash" text NOT NULL,
	"token_prefix" text NOT NULL,
	"revoked" boolean DEFAULT false NOT NULL,
	"revoked_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_workflow_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"project_id" text,
	"status" "generation_status" DEFAULT 'queued' NOT NULL,
	"progress" jsonb,
	"outputs" jsonb,
	"input_overrides" jsonb,
	"error_code" text,
	"error_message" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "runtime_automation_active_revisions" (
	"workspace_id" text NOT NULL,
	"automation_id" text NOT NULL,
	"revision_id" text NOT NULL,
	"revision" integer NOT NULL,
	"activation_id" text NOT NULL,
	"activated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "runtime_automation_active_revisions_pk" PRIMARY KEY("workspace_id","automation_id"),
	CONSTRAINT "runtime_automation_active_revisions_revision_check" CHECK ("runtime_automation_active_revisions"."revision" > 0)
);
--> statement-breakpoint
CREATE TABLE "runtime_automation_events" (
	"workspace_id" text NOT NULL,
	"automation_id" text NOT NULL,
	"id" text NOT NULL,
	"sequence" integer NOT NULL,
	"type" text NOT NULL,
	"occurrence_id" text,
	"revision_id" text,
	"evidence" jsonb NOT NULL,
	"record" jsonb NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	CONSTRAINT "runtime_automation_events_pk" PRIMARY KEY("workspace_id","automation_id","id"),
	CONSTRAINT "runtime_automation_events_sequence_check" CHECK ("runtime_automation_events"."sequence" > 0),
	CONSTRAINT "runtime_automation_events_type_check" CHECK ("runtime_automation_events"."type" in ('automation.created','automation.revision_created','automation.revision_activated','occurrence.accepted','occurrence.materialization_started','occurrence.workflow_materialized','occurrence.materialization_failed','occurrence.cancellation_requested','occurrence.cancelled','occurrence.succeeded','occurrence.failed','occurrence.retry_derived'))
);
--> statement-breakpoint
CREATE TABLE "runtime_automation_mutation_receipts" (
	"workspace_id" text NOT NULL,
	"principal_id" text NOT NULL,
	"key_id" text NOT NULL,
	"authorization_evidence_ref" text NOT NULL,
	"capability" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_fingerprint" text NOT NULL,
	"resource_id" text NOT NULL,
	"result" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "runtime_automation_mutation_receipts_pk" PRIMARY KEY("workspace_id","principal_id","capability","idempotency_key"),
	CONSTRAINT "runtime_automation_mutation_receipts_fingerprint_check" CHECK ("runtime_automation_mutation_receipts"."request_fingerprint" ~ '^sha256:[a-f0-9]{64}$'),
	CONSTRAINT "runtime_automation_mutation_receipts_capability_check" CHECK ("runtime_automation_mutation_receipts"."capability" in ('automations.create@1','automation_revisions.create@1','automation_revisions.activate@1','automations.invoke@1','automation_occurrences.cancel@1','automation_occurrences.retry@1'))
);
--> statement-breakpoint
CREATE TABLE "runtime_automation_occurrence_artifacts" (
	"workspace_id" text NOT NULL,
	"automation_id" text NOT NULL,
	"occurrence_id" text NOT NULL,
	"position" integer NOT NULL,
	"artifact_id" text NOT NULL,
	"content_digest" text NOT NULL,
	"kind" text NOT NULL,
	"origin" text NOT NULL,
	CONSTRAINT "runtime_automation_occurrence_artifacts_pk" PRIMARY KEY("workspace_id","occurrence_id","position"),
	CONSTRAINT "runtime_automation_occurrence_artifacts_position_check" CHECK ("runtime_automation_occurrence_artifacts"."position" >= 0 and "runtime_automation_occurrence_artifacts"."kind" = 'image' and "runtime_automation_occurrence_artifacts"."origin" = 'imported' and "runtime_automation_occurrence_artifacts"."content_digest" ~ '^sha256:[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE TABLE "runtime_automation_occurrence_cancellations" (
	"workspace_id" text NOT NULL,
	"automation_id" text NOT NULL,
	"occurrence_id" text NOT NULL,
	"id" text NOT NULL,
	"requesting_principal_id" text NOT NULL,
	"requesting_key_id" text NOT NULL,
	"authorization_evidence_ref" text NOT NULL,
	"disposition" text NOT NULL,
	"workflow_run_id" text,
	"record" jsonb NOT NULL,
	"requested_at" timestamp with time zone NOT NULL,
	CONSTRAINT "runtime_automation_occurrence_cancellations_pk" PRIMARY KEY("workspace_id","occurrence_id"),
	CONSTRAINT "runtime_automation_occurrence_cancellations_disposition_check" CHECK ("runtime_automation_occurrence_cancellations"."disposition" in ('prevented','cancellation_requested','too_late'))
);
--> statement-breakpoint
CREATE TABLE "runtime_automation_occurrences" (
	"workspace_id" text NOT NULL,
	"automation_id" text NOT NULL,
	"id" text NOT NULL,
	"automation_revision_id" text NOT NULL,
	"automation_revision" integer NOT NULL,
	"automation_revision_digest" text NOT NULL,
	"source_occurrence_key" text NOT NULL,
	"request_fingerprint" text NOT NULL,
	"state" text NOT NULL,
	"stage" text NOT NULL,
	"desired_state" text NOT NULL,
	"requesting_principal_id" text NOT NULL,
	"requesting_key_id" text NOT NULL,
	"invocation_authorization_evidence_ref" text NOT NULL,
	"workflow_id" text NOT NULL,
	"workflow_revision_id" text NOT NULL,
	"workflow_revision" integer NOT NULL,
	"workflow_definition_digest" text NOT NULL,
	"workflow_run_id" text,
	"workflow_run_start_snapshot_digest" text,
	"failure_code" text,
	"cancel_requested_at" timestamp with time zone,
	"record" jsonb NOT NULL,
	"accepted_at" timestamp with time zone NOT NULL,
	"started_at" timestamp with time zone,
	"updated_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "runtime_automation_occurrences_pk" PRIMARY KEY("workspace_id","id"),
	CONSTRAINT "runtime_automation_occurrences_state_check" CHECK ("runtime_automation_occurrences"."state" in ('queued','running','waiting','succeeded','failed','cancelled','skipped') and "runtime_automation_occurrences"."stage" in ('accepted','workflow_materialization','workflow_running','complete') and "runtime_automation_occurrences"."desired_state" in ('run','cancel')),
	CONSTRAINT "runtime_automation_occurrences_digest_check" CHECK ("runtime_automation_occurrences"."automation_revision_digest" ~ '^sha256:[a-f0-9]{64}$' and "runtime_automation_occurrences"."workflow_definition_digest" ~ '^sha256:[a-f0-9]{64}$' and "runtime_automation_occurrences"."workflow_revision" > 0 and "runtime_automation_occurrences"."request_fingerprint" ~ '^sha256:[a-f0-9]{64}$' and ("runtime_automation_occurrences"."workflow_run_start_snapshot_digest" is null or "runtime_automation_occurrences"."workflow_run_start_snapshot_digest" ~ '^sha256:[a-f0-9]{64}$')),
	CONSTRAINT "runtime_automation_occurrences_run_link_check" CHECK (("runtime_automation_occurrences"."workflow_run_id" is null and "runtime_automation_occurrences"."workflow_run_start_snapshot_digest" is null) or ("runtime_automation_occurrences"."workflow_run_id" is not null and "runtime_automation_occurrences"."workflow_run_start_snapshot_digest" is not null))
);
--> statement-breakpoint
CREATE TABLE "runtime_automation_outbox_intents" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"automation_id" text NOT NULL,
	"occurrence_id" text NOT NULL,
	"purpose" text NOT NULL,
	"generation" integer NOT NULL,
	"dedupe_key" text NOT NULL,
	"state" text NOT NULL,
	"available_at" timestamp with time zone NOT NULL,
	"claim_token" text,
	"delivery_attempts" integer DEFAULT 0 NOT NULL,
	"claimed_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"record" jsonb NOT NULL,
	CONSTRAINT "runtime_automation_outbox_state_check" CHECK ("runtime_automation_outbox_intents"."purpose" in ('materialize_workflow','observe_workflow','cancel_workflow') and "runtime_automation_outbox_intents"."state" in ('pending','claimed','delivered','cancelled') and "runtime_automation_outbox_intents"."generation" > 0 and "runtime_automation_outbox_intents"."delivery_attempts" >= 0),
	CONSTRAINT "runtime_automation_outbox_lifecycle_check" CHECK (("runtime_automation_outbox_intents"."state" = 'pending' and "runtime_automation_outbox_intents"."claim_token" is null and "runtime_automation_outbox_intents"."claimed_at" is null and "runtime_automation_outbox_intents"."delivered_at" is null and "runtime_automation_outbox_intents"."cancelled_at" is null) or ("runtime_automation_outbox_intents"."state" = 'claimed' and "runtime_automation_outbox_intents"."claim_token" is not null and "runtime_automation_outbox_intents"."claimed_at" is not null and "runtime_automation_outbox_intents"."delivered_at" is null and "runtime_automation_outbox_intents"."cancelled_at" is null) or ("runtime_automation_outbox_intents"."state" = 'delivered' and "runtime_automation_outbox_intents"."claim_token" is null and "runtime_automation_outbox_intents"."claimed_at" is not null and "runtime_automation_outbox_intents"."delivered_at" is not null and "runtime_automation_outbox_intents"."cancelled_at" is null) or ("runtime_automation_outbox_intents"."state" = 'cancelled' and "runtime_automation_outbox_intents"."claim_token" is null and "runtime_automation_outbox_intents"."delivered_at" is null and "runtime_automation_outbox_intents"."cancelled_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "runtime_automation_revision_activations" (
	"workspace_id" text NOT NULL,
	"automation_id" text NOT NULL,
	"id" text NOT NULL,
	"revision_id" text NOT NULL,
	"revision" integer NOT NULL,
	"prior_revision_id" text,
	"actor_principal_id" text NOT NULL,
	"actor_key_id" text NOT NULL,
	"authorization_evidence_ref" text NOT NULL,
	"record" jsonb NOT NULL,
	"activated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "runtime_automation_revision_activations_pk" PRIMARY KEY("workspace_id","automation_id","id"),
	CONSTRAINT "runtime_automation_revision_activations_revision_check" CHECK ("runtime_automation_revision_activations"."revision" > 0)
);
--> statement-breakpoint
CREATE TABLE "runtime_automation_revision_artifact_bindings" (
	"workspace_id" text NOT NULL,
	"automation_id" text NOT NULL,
	"revision_id" text NOT NULL,
	"position" integer NOT NULL,
	"input_name" text NOT NULL,
	"artifact_id" text NOT NULL,
	"content_digest" text NOT NULL,
	"kind" text NOT NULL,
	"origin" text NOT NULL,
	CONSTRAINT "runtime_automation_revision_artifact_bindings_pk" PRIMARY KEY("workspace_id","automation_id","revision_id","input_name"),
	CONSTRAINT "runtime_automation_revision_artifact_bindings_position_check" CHECK ("runtime_automation_revision_artifact_bindings"."position" >= 0 and length("runtime_automation_revision_artifact_bindings"."input_name") between 1 and 200 and "runtime_automation_revision_artifact_bindings"."kind" = 'image' and "runtime_automation_revision_artifact_bindings"."origin" = 'imported' and "runtime_automation_revision_artifact_bindings"."content_digest" ~ '^sha256:[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE TABLE "runtime_automation_revisions" (
	"workspace_id" text NOT NULL,
	"automation_id" text NOT NULL,
	"id" text NOT NULL,
	"revision" integer NOT NULL,
	"definition_digest" text NOT NULL,
	"workflow_id" text NOT NULL,
	"workflow_revision_id" text NOT NULL,
	"workflow_revision" integer NOT NULL,
	"workflow_definition_digest" text NOT NULL,
	"record" jsonb NOT NULL,
	"author_principal_id" text NOT NULL,
	"author_key_id" text NOT NULL,
	"creation_authorization_evidence_ref" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "runtime_automation_revisions_pk" PRIMARY KEY("workspace_id","automation_id","id"),
	CONSTRAINT "runtime_automation_revisions_digest_check" CHECK ("runtime_automation_revisions"."definition_digest" ~ '^sha256:[a-f0-9]{64}$' and "runtime_automation_revisions"."workflow_definition_digest" ~ '^sha256:[a-f0-9]{64}$' and "runtime_automation_revisions"."revision" > 0 and "runtime_automation_revisions"."workflow_revision" > 0)
);
--> statement-breakpoint
CREATE TABLE "runtime_automation_stage_attempts" (
	"workspace_id" text NOT NULL,
	"automation_id" text NOT NULL,
	"occurrence_id" text NOT NULL,
	"id" text NOT NULL,
	"stage" text NOT NULL,
	"attempt" integer NOT NULL,
	"effect_key" text NOT NULL,
	"state" text NOT NULL,
	"workflow_run_id" text,
	"failure_code" text,
	"record" jsonb NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "runtime_automation_stage_attempts_pk" PRIMARY KEY("workspace_id","occurrence_id","id"),
	CONSTRAINT "runtime_automation_stage_attempts_state_check" CHECK ("runtime_automation_stage_attempts"."stage" = 'workflow_materialization' and "runtime_automation_stage_attempts"."state" in ('running','succeeded','failed') and "runtime_automation_stage_attempts"."attempt" > 0),
	CONSTRAINT "runtime_automation_stage_attempts_result_check" CHECK (("runtime_automation_stage_attempts"."state" = 'running' and "runtime_automation_stage_attempts"."completed_at" is null and "runtime_automation_stage_attempts"."workflow_run_id" is null and "runtime_automation_stage_attempts"."failure_code" is null) or ("runtime_automation_stage_attempts"."state" = 'succeeded' and "runtime_automation_stage_attempts"."completed_at" is not null and "runtime_automation_stage_attempts"."workflow_run_id" is not null and "runtime_automation_stage_attempts"."failure_code" is null) or ("runtime_automation_stage_attempts"."state" = 'failed' and "runtime_automation_stage_attempts"."completed_at" is not null and "runtime_automation_stage_attempts"."workflow_run_id" is null and "runtime_automation_stage_attempts"."failure_code" is not null))
);
--> statement-breakpoint
CREATE TABLE "runtime_automations" (
	"workspace_id" text NOT NULL,
	"id" text NOT NULL,
	"control_state" text NOT NULL,
	"control_version" integer NOT NULL,
	"next_revision" integer NOT NULL,
	"next_event_sequence" integer NOT NULL,
	"created_by_principal_id" text NOT NULL,
	"record" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "runtime_automations_pk" PRIMARY KEY("workspace_id","id"),
	CONSTRAINT "runtime_automations_state_check" CHECK ("runtime_automations"."control_state" in ('active','paused','retired')),
	CONSTRAINT "runtime_automations_counters_check" CHECK ("runtime_automations"."control_version" > 0 and "runtime_automations"."next_revision" > 0 and "runtime_automations"."next_event_sequence" > 0)
);
--> statement-breakpoint
CREATE TABLE "workspace_provider_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"provider" "byok_provider" NOT NULL,
	"key_encrypted" text NOT NULL,
	"key_hint" text NOT NULL,
	"last_validated_at" timestamp with time zone,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_workflow_runs" ADD CONSTRAINT "project_workflow_runs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_workflow_runs" ADD CONSTRAINT "project_workflow_runs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_workflow_runs" ADD CONSTRAINT "project_workflow_runs_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_automation_active_revisions" ADD CONSTRAINT "runtime_automation_active_revisions_revision_fk" FOREIGN KEY ("workspace_id","automation_id","revision_id","revision") REFERENCES "public"."runtime_automation_revisions"("workspace_id","automation_id","id","revision") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_automation_events" ADD CONSTRAINT "runtime_automation_events_automation_fk" FOREIGN KEY ("workspace_id","automation_id") REFERENCES "public"."runtime_automations"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_automation_events" ADD CONSTRAINT "runtime_automation_events_occurrence_fk" FOREIGN KEY ("workspace_id","automation_id","occurrence_id") REFERENCES "public"."runtime_automation_occurrences"("workspace_id","automation_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_automation_events" ADD CONSTRAINT "runtime_automation_events_revision_fk" FOREIGN KEY ("workspace_id","automation_id","revision_id") REFERENCES "public"."runtime_automation_revisions"("workspace_id","automation_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_automation_mutation_receipts" ADD CONSTRAINT "runtime_automation_mutation_receipts_principal_fk" FOREIGN KEY ("workspace_id","principal_id") REFERENCES "public"."agent_principals"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_automation_mutation_receipts" ADD CONSTRAINT "runtime_automation_mutation_receipts_key_fk" FOREIGN KEY ("principal_id","key_id") REFERENCES "public"."agent_keys"("principal_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_automation_mutation_receipts" ADD CONSTRAINT "runtime_automation_mutation_receipts_evidence_fk" FOREIGN KEY ("workspace_id","principal_id","key_id","authorization_evidence_ref") REFERENCES "public"."agent_authorization_decisions"("workspace_id","principal_id","key_id","operator_trace_ref") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_automation_occurrence_artifacts" ADD CONSTRAINT "runtime_automation_occurrence_artifacts_occurrence_fk" FOREIGN KEY ("workspace_id","automation_id","occurrence_id") REFERENCES "public"."runtime_automation_occurrences"("workspace_id","automation_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_automation_occurrence_artifacts" ADD CONSTRAINT "runtime_automation_occurrence_artifacts_artifact_content_fk" FOREIGN KEY ("workspace_id","artifact_id","kind","content_digest") REFERENCES "public"."artifacts"("workspace_id","id","kind","content_digest") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_automation_occurrence_artifacts" ADD CONSTRAINT "runtime_automation_occurrence_artifacts_artifact_origin_fk" FOREIGN KEY ("workspace_id","artifact_id","origin") REFERENCES "public"."artifacts"("workspace_id","id","origin") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_automation_occurrence_cancellations" ADD CONSTRAINT "runtime_automation_occurrence_cancellations_occurrence_fk" FOREIGN KEY ("workspace_id","automation_id","occurrence_id") REFERENCES "public"."runtime_automation_occurrences"("workspace_id","automation_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_automation_occurrence_cancellations" ADD CONSTRAINT "runtime_automation_occurrence_cancellations_requester_key_fk" FOREIGN KEY ("requesting_principal_id","requesting_key_id") REFERENCES "public"."agent_keys"("principal_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_automation_occurrence_cancellations" ADD CONSTRAINT "runtime_automation_occurrence_cancellations_evidence_fk" FOREIGN KEY ("workspace_id","requesting_principal_id","requesting_key_id","authorization_evidence_ref") REFERENCES "public"."agent_authorization_decisions"("workspace_id","principal_id","key_id","operator_trace_ref") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_automation_occurrence_cancellations" ADD CONSTRAINT "runtime_automation_occurrence_cancellations_workflow_run_fk" FOREIGN KEY ("workspace_id","workflow_run_id") REFERENCES "public"."workflow_runs"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_automation_occurrences" ADD CONSTRAINT "runtime_automation_occurrences_automation_fk" FOREIGN KEY ("workspace_id","automation_id") REFERENCES "public"."runtime_automations"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_automation_occurrences" ADD CONSTRAINT "runtime_automation_occurrences_revision_fk" FOREIGN KEY ("workspace_id","automation_id","automation_revision_id") REFERENCES "public"."runtime_automation_revisions"("workspace_id","automation_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_automation_occurrences" ADD CONSTRAINT "runtime_automation_occurrences_workflow_revision_fk" FOREIGN KEY ("workspace_id","workflow_id","workflow_revision_id","workflow_revision","workflow_definition_digest") REFERENCES "public"."content_workflow_revisions"("workspace_id","workflow_id","id","revision","definition_digest") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_automation_occurrences" ADD CONSTRAINT "runtime_automation_occurrences_requester_key_fk" FOREIGN KEY ("requesting_principal_id","requesting_key_id") REFERENCES "public"."agent_keys"("principal_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_automation_occurrences" ADD CONSTRAINT "runtime_automation_occurrences_invocation_evidence_fk" FOREIGN KEY ("workspace_id","requesting_principal_id","requesting_key_id","invocation_authorization_evidence_ref") REFERENCES "public"."agent_authorization_decisions"("workspace_id","principal_id","key_id","operator_trace_ref") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_automation_occurrences" ADD CONSTRAINT "runtime_automation_occurrences_workflow_run_fk" FOREIGN KEY ("workspace_id","workflow_run_id") REFERENCES "public"."workflow_runs"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_automation_outbox_intents" ADD CONSTRAINT "runtime_automation_outbox_occurrence_fk" FOREIGN KEY ("workspace_id","automation_id","occurrence_id") REFERENCES "public"."runtime_automation_occurrences"("workspace_id","automation_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_automation_revision_activations" ADD CONSTRAINT "runtime_automation_revision_activations_revision_fk" FOREIGN KEY ("workspace_id","automation_id","revision_id") REFERENCES "public"."runtime_automation_revisions"("workspace_id","automation_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_automation_revision_activations" ADD CONSTRAINT "runtime_automation_revision_activations_prior_revision_fk" FOREIGN KEY ("workspace_id","automation_id","prior_revision_id") REFERENCES "public"."runtime_automation_revisions"("workspace_id","automation_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_automation_revision_activations" ADD CONSTRAINT "runtime_automation_revision_activations_actor_key_fk" FOREIGN KEY ("actor_principal_id","actor_key_id") REFERENCES "public"."agent_keys"("principal_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_automation_revision_activations" ADD CONSTRAINT "runtime_automation_revision_activations_evidence_fk" FOREIGN KEY ("workspace_id","actor_principal_id","actor_key_id","authorization_evidence_ref") REFERENCES "public"."agent_authorization_decisions"("workspace_id","principal_id","key_id","operator_trace_ref") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_automation_revision_artifact_bindings" ADD CONSTRAINT "runtime_automation_revision_artifact_bindings_revision_fk" FOREIGN KEY ("workspace_id","automation_id","revision_id") REFERENCES "public"."runtime_automation_revisions"("workspace_id","automation_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_automation_revision_artifact_bindings" ADD CONSTRAINT "runtime_automation_revision_artifact_bindings_artifact_content_fk" FOREIGN KEY ("workspace_id","artifact_id","kind","content_digest") REFERENCES "public"."artifacts"("workspace_id","id","kind","content_digest") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_automation_revision_artifact_bindings" ADD CONSTRAINT "runtime_automation_revision_artifact_bindings_artifact_origin_fk" FOREIGN KEY ("workspace_id","artifact_id","origin") REFERENCES "public"."artifacts"("workspace_id","id","origin") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_automation_revisions" ADD CONSTRAINT "runtime_automation_revisions_automation_fk" FOREIGN KEY ("workspace_id","automation_id") REFERENCES "public"."runtime_automations"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_automation_revisions" ADD CONSTRAINT "runtime_automation_revisions_author_fk" FOREIGN KEY ("workspace_id","author_principal_id") REFERENCES "public"."agent_principals"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_automation_revisions" ADD CONSTRAINT "runtime_automation_revisions_author_key_fk" FOREIGN KEY ("author_principal_id","author_key_id") REFERENCES "public"."agent_keys"("principal_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_automation_revisions" ADD CONSTRAINT "runtime_automation_revisions_evidence_fk" FOREIGN KEY ("workspace_id","author_principal_id","author_key_id","creation_authorization_evidence_ref") REFERENCES "public"."agent_authorization_decisions"("workspace_id","principal_id","key_id","operator_trace_ref") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_automation_revisions" ADD CONSTRAINT "runtime_automation_revisions_workflow_revision_fk" FOREIGN KEY ("workspace_id","workflow_id","workflow_revision_id","workflow_revision","workflow_definition_digest") REFERENCES "public"."content_workflow_revisions"("workspace_id","workflow_id","id","revision","definition_digest") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_automation_stage_attempts" ADD CONSTRAINT "runtime_automation_stage_attempts_occurrence_fk" FOREIGN KEY ("workspace_id","automation_id","occurrence_id") REFERENCES "public"."runtime_automation_occurrences"("workspace_id","automation_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_automation_stage_attempts" ADD CONSTRAINT "runtime_automation_stage_attempts_workflow_run_fk" FOREIGN KEY ("workspace_id","workflow_run_id") REFERENCES "public"."workflow_runs"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_automations" ADD CONSTRAINT "runtime_automations_workspace_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_automations" ADD CONSTRAINT "runtime_automations_creator_fk" FOREIGN KEY ("workspace_id","created_by_principal_id") REFERENCES "public"."agent_principals"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_provider_keys" ADD CONSTRAINT "workspace_provider_keys_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_provider_keys" ADD CONSTRAINT "workspace_provider_keys_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "api_tokens_token_hash_unique" ON "api_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "api_tokens_workspace_idx" ON "api_tokens" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "api_tokens_created_at_idx" ON "api_tokens" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "project_workflow_runs_workspace_idx" ON "project_workflow_runs" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "project_workflow_runs_project_idx" ON "project_workflow_runs" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "project_workflow_runs_status_idx" ON "project_workflow_runs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "project_workflow_runs_created_at_idx" ON "project_workflow_runs" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "runtime_automation_events_sequence_unique" ON "runtime_automation_events" USING btree ("workspace_id","automation_id","sequence");--> statement-breakpoint
CREATE INDEX "runtime_automation_events_sequence_idx" ON "runtime_automation_events" USING btree ("workspace_id","automation_id","sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "runtime_automation_occurrence_artifacts_unique" ON "runtime_automation_occurrence_artifacts" USING btree ("workspace_id","occurrence_id","artifact_id");--> statement-breakpoint
CREATE UNIQUE INDEX "runtime_automation_occurrence_cancellations_id_unique" ON "runtime_automation_occurrence_cancellations" USING btree ("workspace_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "runtime_automation_occurrences_source_key_unique" ON "runtime_automation_occurrences" USING btree ("workspace_id","automation_id","source_occurrence_key");--> statement-breakpoint
CREATE UNIQUE INDEX "runtime_automation_occurrences_automation_id_unique" ON "runtime_automation_occurrences" USING btree ("workspace_id","automation_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "runtime_automation_occurrences_workflow_run_unique" ON "runtime_automation_occurrences" USING btree ("workspace_id","workflow_run_id");--> statement-breakpoint
CREATE INDEX "runtime_automation_occurrences_accepted_idx" ON "runtime_automation_occurrences" USING btree ("workspace_id","automation_id","accepted_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "runtime_automation_outbox_occurrence_generation_unique" ON "runtime_automation_outbox_intents" USING btree ("workspace_id","occurrence_id","generation");--> statement-breakpoint
CREATE UNIQUE INDEX "runtime_automation_outbox_dedupe_key_unique" ON "runtime_automation_outbox_intents" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX "runtime_automation_outbox_claim_idx" ON "runtime_automation_outbox_intents" USING btree ("state","available_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "runtime_automation_revision_artifact_bindings_position_unique" ON "runtime_automation_revision_artifact_bindings" USING btree ("workspace_id","automation_id","revision_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "runtime_automation_revisions_number_unique" ON "runtime_automation_revisions" USING btree ("workspace_id","automation_id","revision");--> statement-breakpoint
CREATE UNIQUE INDEX "runtime_automation_revisions_identity_unique" ON "runtime_automation_revisions" USING btree ("workspace_id","automation_id","id","revision");--> statement-breakpoint
CREATE UNIQUE INDEX "runtime_automation_stage_attempts_number_unique" ON "runtime_automation_stage_attempts" USING btree ("workspace_id","occurrence_id","stage","attempt");--> statement-breakpoint
CREATE INDEX "runtime_automations_workspace_state_idx" ON "runtime_automations" USING btree ("workspace_id","control_state","id");--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_provider_keys_workspace_provider_unique" ON "workspace_provider_keys" USING btree ("workspace_id","provider");--> statement-breakpoint
CREATE INDEX "workspace_provider_keys_workspace_idx" ON "workspace_provider_keys" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "content_workflow_revisions_workspace_workflow_identity_unique" ON "content_workflow_revisions" USING btree ("workspace_id","workflow_id","id","revision","definition_digest");