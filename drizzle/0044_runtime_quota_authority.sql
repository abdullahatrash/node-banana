CREATE TABLE "runtime_quota_admin_receipts" (
	"workspace_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_digest" text NOT NULL,
	"resource_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "runtime_quota_admin_receipts_pk" PRIMARY KEY("workspace_id","idempotency_key"),
	CONSTRAINT "runtime_quota_admin_receipts_digest_check" CHECK ("runtime_quota_admin_receipts"."request_digest" ~ '^sha256:[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE TABLE "runtime_quota_claim_receipts" (
	"workspace_id" text NOT NULL,
	"transition_key" text NOT NULL,
	"request_digest" text NOT NULL,
	"result" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "runtime_quota_claim_receipts_pk" PRIMARY KEY("workspace_id","transition_key"),
	CONSTRAINT "runtime_quota_claim_receipts_digest_check" CHECK ("runtime_quota_claim_receipts"."request_digest" ~ '^sha256:[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE TABLE "runtime_quota_policies" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"principal_id" text,
	"scope" text NOT NULL,
	"kind" text NOT NULL,
	"boundary" text NOT NULL,
	"dimension" text NOT NULL,
	"unit" text NOT NULL,
	"window" text NOT NULL,
	"timezone" text NOT NULL,
	"reservation_rule" text NOT NULL,
	"status" text NOT NULL,
	"current_revision_id" text NOT NULL,
	"policy" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "runtime_quota_policies_json_shape_check" CHECK ("policy" @> jsonb_build_object('schema', 'quota-policy/v1', 'id', "id", 'workspaceId', "workspace_id", 'principalId', "principal_id", 'scope', "scope", 'kind', "kind", 'boundary', "boundary", 'dimension', "dimension", 'unit', "unit", 'window', "window", 'timezone', "timezone", 'reservationRule', "reservation_rule", 'status', "status", 'currentRevisionId', "current_revision_id") and "policy" ?& array['createdAt','updatedAt'] and jsonb_typeof("policy"->'createdAt') = 'string' and jsonb_typeof("policy"->'updatedAt') = 'string'),
	CONSTRAINT "runtime_quota_policies_scope_check" CHECK (("runtime_quota_policies"."scope" = 'workspace' and "runtime_quota_policies"."principal_id" is null) or ("runtime_quota_policies"."scope" = 'principal' and "runtime_quota_policies"."principal_id" is not null)),
	CONSTRAINT "runtime_quota_policies_identity_check" CHECK ("runtime_quota_policies"."kind" in ('admission','concurrency','rate','storage','usage') and "runtime_quota_policies"."dimension" ~ '^[a-z][a-z0-9_.-]{0,99}@[1-9][0-9]{0,8}$' and "runtime_quota_policies"."unit" in ('count','byte','millisecond','megapixel') and "runtime_quota_policies"."window" in ('concurrent','calendar_minute','calendar_hour','calendar_day','calendar_week','calendar_month','lifetime') and "runtime_quota_policies"."status" in ('active','revoked') and (("runtime_quota_policies"."kind" = 'admission' and "runtime_quota_policies"."boundary" = 'run_admission' and "runtime_quota_policies"."window" <> 'concurrent' and "runtime_quota_policies"."reservation_rule" = 'consume') or ("runtime_quota_policies"."kind" = 'concurrency' and "runtime_quota_policies"."boundary" = 'run_concurrency' and "runtime_quota_policies"."window" = 'concurrent' and "runtime_quota_policies"."reservation_rule" = 'release_on_terminal' and "runtime_quota_policies"."unit" = 'count') or ("runtime_quota_policies"."kind" = 'rate' and "runtime_quota_policies"."boundary" = 'provider_effect' and "runtime_quota_policies"."window" not in ('concurrent','lifetime') and "runtime_quota_policies"."reservation_rule" = 'consume') or ("runtime_quota_policies"."kind" = 'storage' and "runtime_quota_policies"."boundary" = 'artifact_storage' and "runtime_quota_policies"."window" in ('concurrent','lifetime') and "runtime_quota_policies"."reservation_rule" = 'release_on_transition' and "runtime_quota_policies"."unit" = 'byte') or ("runtime_quota_policies"."kind" = 'usage' and "runtime_quota_policies"."boundary" = 'usage_settlement' and "runtime_quota_policies"."window" <> 'concurrent' and "runtime_quota_policies"."reservation_rule" = 'consume'))),
	CONSTRAINT "runtime_quota_policies_json_scalar_check" CHECK ("policy"->>'schema' = 'quota-policy/v1' and "policy"->>'id' = "id" and "policy"->>'workspaceId' = "workspace_id" and ("policy"->>'principalId') is not distinct from "principal_id" and "policy"->>'scope' = "scope" and "policy"->>'kind' = "kind" and "policy"->>'boundary' = "boundary" and "policy"->>'dimension' = "dimension" and "policy"->>'unit' = "unit" and "policy"->>'window' = "window" and "policy"->>'timezone' = "timezone" and "policy"->>'reservationRule' = "reservation_rule" and "policy"->>'status' = "status" and "policy"->>'currentRevisionId' = "current_revision_id" and ("policy"->>'createdAt')::timestamptz = "created_at" and ("policy"->>'updatedAt')::timestamptz = "updated_at")
);
--> statement-breakpoint
CREATE TABLE "runtime_quota_policy_revisions" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"policy_id" text NOT NULL,
	"principal_id" text,
	"revision" integer NOT NULL,
	"warning_threshold" text NOT NULL,
	"hard_limit" text NOT NULL,
	"exhaustion_behavior" text NOT NULL,
	"created_by_user_id" text NOT NULL,
	"revision_record" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "runtime_quota_policy_revisions_json_shape_check" CHECK ("revision_record" @> jsonb_build_object('schema', 'quota-policy-revision/v1', 'id', "id", 'workspaceId', "workspace_id", 'policyId', "policy_id", 'principalId', "principal_id", 'revision', "revision", 'warningThreshold', "warning_threshold", 'hardLimit', "hard_limit", 'exhaustionBehavior', "exhaustion_behavior", 'createdByUserId', "created_by_user_id") and "revision_record" ? 'createdAt' and jsonb_typeof("revision_record"->'createdAt') = 'string'),
	CONSTRAINT "runtime_quota_policy_revisions_value_check" CHECK ("runtime_quota_policy_revisions"."revision" > 0 and "runtime_quota_policy_revisions"."warning_threshold" ~ '^(0|[1-9][0-9]*)(\.[0-9]+)?$' and "runtime_quota_policy_revisions"."hard_limit" ~ '^[1-9][0-9]*(\.[0-9]+)?$' and "runtime_quota_policy_revisions"."warning_threshold"::numeric <= "runtime_quota_policy_revisions"."hard_limit"::numeric and "runtime_quota_policy_revisions"."exhaustion_behavior" in ('deny','wait')),
	CONSTRAINT "runtime_quota_policy_revisions_json_scalar_check" CHECK ("revision_record"->>'schema' = 'quota-policy-revision/v1' and "revision_record"->>'id' = "id" and "revision_record"->>'workspaceId' = "workspace_id" and "revision_record"->>'policyId' = "policy_id" and ("revision_record"->>'principalId') is not distinct from "principal_id" and ("revision_record"->>'revision')::integer = "revision" and "revision_record"->>'warningThreshold' = "warning_threshold" and "revision_record"->>'hardLimit' = "hard_limit" and "revision_record"->>'exhaustionBehavior' = "exhaustion_behavior" and "revision_record"->>'createdByUserId' = "created_by_user_id" and ("revision_record"->>'createdAt')::timestamptz = "created_at")
);
--> statement-breakpoint
CREATE TABLE "runtime_quota_reservation_events" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"reservation_id" text NOT NULL,
	"transition_id" text NOT NULL,
	"event_type" text NOT NULL,
	"amount" text NOT NULL,
	"evidence_ref" text NOT NULL,
	"event" jsonb NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	CONSTRAINT "runtime_quota_reservation_events_value_check" CHECK ("runtime_quota_reservation_events"."event_type" in ('held','settled','released') and "runtime_quota_reservation_events"."amount" ~ '^(0|[1-9][0-9]*)(\.[0-9]+)?$')
);
--> statement-breakpoint
CREATE TABLE "runtime_quota_reservations" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"admitted_principal_id" text NOT NULL,
	"principal_id" text,
	"run_id" text,
	"transition_key" text NOT NULL,
	"boundary" text NOT NULL,
	"subject_kind" text NOT NULL,
	"subject_id" text NOT NULL,
	"policy_id" text NOT NULL,
	"policy_revision_id" text NOT NULL,
	"window_id" text NOT NULL,
	"scope" text NOT NULL,
	"kind" text NOT NULL,
	"dimension" text NOT NULL,
	"unit" text NOT NULL,
	"reservation_rule" text NOT NULL,
	"reserved_amount" text NOT NULL,
	"held_amount" text NOT NULL,
	"settled_amount" text NOT NULL,
	"released_amount" text NOT NULL,
	"overage_amount" text NOT NULL,
	"state" text NOT NULL,
	"reservation" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "runtime_quota_reservations_ownership_check" CHECK ("subject_kind" = 'artifact' or "run_id" is not null),
	CONSTRAINT "runtime_quota_reservations_overage_check" CHECK ("overage_amount" ~ '^(0|[1-9][0-9]*)(\.[0-9]+)?$'),
	CONSTRAINT "runtime_quota_reservations_overage_json_check" CHECK ("reservation" @> jsonb_build_object('overageAmount', "overage_amount")),
	CONSTRAINT "runtime_quota_reservations_usage_reconciliation_check" CHECK ("boundary" <> 'usage_settlement' or (("state" = 'held' or ("held_amount"::numeric = 0 and "settled_amount"::numeric + "released_amount"::numeric = "reserved_amount"::numeric)) and ("overage_amount"::numeric = 0 or ("state" = 'settled' and "held_amount"::numeric = 0 and "settled_amount"::numeric = "reserved_amount"::numeric and "released_amount"::numeric = 0)))),
	CONSTRAINT "runtime_quota_reservations_json_shape_check" CHECK ("reservation" @> jsonb_build_object('schema', 'quota-reservation/v1', 'id', "id", 'workspaceId', "workspace_id", 'admittedPrincipalId', "admitted_principal_id", 'principalId', "principal_id", 'runId', "run_id", 'transitionKey', "transition_key", 'boundary', "boundary", 'subject', jsonb_build_object('kind', "subject_kind", 'id', "subject_id"), 'policyId', "policy_id", 'policyRevisionId', "policy_revision_id", 'scope', "scope", 'kind', "kind", 'dimension', "dimension", 'unit', "unit", 'reservationRule', "reservation_rule", 'reservedAmount', "reserved_amount", 'heldAmount', "held_amount", 'settledAmount', "settled_amount", 'releasedAmount', "released_amount", 'state', "state") and "reservation" ?& array['createdAt','updatedAt'] and jsonb_typeof("reservation"->'createdAt') = 'string' and jsonb_typeof("reservation"->'updatedAt') = 'string'),
	CONSTRAINT "runtime_quota_reservations_amount_check" CHECK ("runtime_quota_reservations"."reserved_amount" ~ '^[1-9][0-9]*(\.[0-9]+)?$' and "runtime_quota_reservations"."held_amount" ~ '^(0|[1-9][0-9]*)(\.[0-9]+)?$' and "runtime_quota_reservations"."settled_amount" ~ '^(0|[1-9][0-9]*)(\.[0-9]+)?$' and "runtime_quota_reservations"."released_amount" ~ '^(0|[1-9][0-9]*)(\.[0-9]+)?$' and "runtime_quota_reservations"."held_amount"::numeric + "runtime_quota_reservations"."settled_amount"::numeric <= "runtime_quota_reservations"."reserved_amount"::numeric and "runtime_quota_reservations"."released_amount"::numeric <= "runtime_quota_reservations"."reserved_amount"::numeric and ("runtime_quota_reservations"."reservation_rule" <> 'release_on_transition' or "runtime_quota_reservations"."released_amount"::numeric <= "runtime_quota_reservations"."settled_amount"::numeric)),
	CONSTRAINT "runtime_quota_reservations_state_check" CHECK (("state" = 'held' and "held_amount"::numeric > 0) or ("state" = 'settled' and "held_amount"::numeric = 0 and ("settled_amount"::numeric + "overage_amount"::numeric) > 0) or ("state" = 'released' and "held_amount"::numeric = 0 and ("reservation_rule" = 'release_on_terminal' or ("reservation_rule" = 'consume' and ("settled_amount"::numeric + "overage_amount"::numeric) = 0) or ("reservation_rule" = 'release_on_transition' and "settled_amount"::numeric = "released_amount"::numeric)))),
	CONSTRAINT "runtime_quota_reservations_json_scalar_check" CHECK ("reservation"->>'schema' = 'quota-reservation/v1' and "reservation"->>'id' = "id" and "reservation"->>'workspaceId' = "workspace_id" and "reservation"->>'admittedPrincipalId' = "admitted_principal_id" and ("reservation"->>'principalId') is not distinct from "principal_id" and "reservation"->>'runId' = "run_id" and "reservation"->>'transitionKey' = "transition_key" and "reservation"->>'boundary' = "boundary" and "reservation"->'subject'->>'kind' = "subject_kind" and "reservation"->'subject'->>'id' = "subject_id" and "reservation"->>'policyId' = "policy_id" and "reservation"->>'policyRevisionId' = "policy_revision_id" and "reservation"->>'scope' = "scope" and "reservation"->>'kind' = "kind" and "reservation"->>'dimension' = "dimension" and "reservation"->>'unit' = "unit" and "reservation"->>'reservationRule' = "reservation_rule" and "reservation"->>'reservedAmount' = "reserved_amount" and "reservation"->>'heldAmount' = "held_amount" and "reservation"->>'settledAmount' = "settled_amount" and "reservation"->>'releasedAmount' = "released_amount" and "reservation"->>'state' = "state" and ("reservation"->>'createdAt')::timestamptz = "created_at" and ("reservation"->>'updatedAt')::timestamptz = "updated_at")
);
--> statement-breakpoint
CREATE TABLE "runtime_quota_transition_receipts" (
	"workspace_id" text NOT NULL,
	"transition_id" text NOT NULL,
	"request_digest" text NOT NULL,
	"result" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "runtime_quota_transition_receipts_pk" PRIMARY KEY("workspace_id","transition_id"),
	CONSTRAINT "runtime_quota_transition_receipts_digest_check" CHECK ("runtime_quota_transition_receipts"."request_digest" ~ '^sha256:[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE TABLE "runtime_quota_usage_reconciliation_receipts" (
	"workspace_id" text NOT NULL,
	"reconciliation_id" text NOT NULL,
	"request_digest" text NOT NULL,
	"result" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "runtime_quota_usage_reconciliation_receipts_pk" PRIMARY KEY("workspace_id","reconciliation_id"),
	CONSTRAINT "runtime_quota_usage_reconciliation_receipts_digest_check" CHECK ("request_digest" ~ '^sha256:[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE TABLE "runtime_quota_waits" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"admitted_principal_id" text NOT NULL,
	"run_id" text NOT NULL,
	"transition_key" text NOT NULL,
	"state" text NOT NULL,
	"eligible_at" timestamp with time zone,
	"reason_code" text NOT NULL,
	"wait" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "runtime_quota_waits_json_shape_check" CHECK ("wait" @> jsonb_build_object('schema', 'quota-wait/v1', 'id', "id", 'workspaceId', "workspace_id", 'admittedPrincipalId', "admitted_principal_id", 'runId', "run_id", 'transitionKey', "transition_key", 'state', "state", 'reasonCode', "reason_code") and "wait" ?& array['eligibleAt','createdAt','resolvedAt'] and (jsonb_typeof("wait"->'eligibleAt') = 'string' or jsonb_typeof("wait"->'eligibleAt') = 'null') and jsonb_typeof("wait"->'createdAt') = 'string' and (jsonb_typeof("wait"->'resolvedAt') = 'string' or jsonb_typeof("wait"->'resolvedAt') = 'null')),
	CONSTRAINT "runtime_quota_waits_state_check" CHECK ("runtime_quota_waits"."state" in ('waiting','resumed','cancelled') and "runtime_quota_waits"."reason_code" = 'QUOTA_RENEWABLE_CAPACITY_EXHAUSTED'),
	CONSTRAINT "runtime_quota_waits_json_scalar_check" CHECK ("wait"->>'schema' = 'quota-wait/v1' and "wait"->>'id' = "id" and "wait"->>'workspaceId' = "workspace_id" and "wait"->>'admittedPrincipalId' = "admitted_principal_id" and "wait"->>'runId' = "run_id" and "wait"->>'transitionKey' = "transition_key" and "wait"->>'state' = "state" and ("wait"->>'eligibleAt')::timestamptz is not distinct from "eligible_at" and "wait"->>'reasonCode' = "reason_code" and ("wait"->>'createdAt')::timestamptz = "created_at" and ("wait"->>'resolvedAt')::timestamptz is not distinct from "resolved_at")
);
--> statement-breakpoint
CREATE TABLE "runtime_quota_windows" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"policy_id" text NOT NULL,
	"kind" text NOT NULL,
	"timezone" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "runtime_quota_windows_interval_check" CHECK (("runtime_quota_windows"."kind" in ('concurrent','lifetime') and "runtime_quota_windows"."ends_at" is null) or ("runtime_quota_windows"."kind" in ('calendar_minute','calendar_hour','calendar_day','calendar_week','calendar_month') and "runtime_quota_windows"."ends_at" > "runtime_quota_windows"."starts_at"))
);
--> statement-breakpoint
ALTER TABLE "workflow_runs" DROP CONSTRAINT "workflow_runs_lifecycle_check";--> statement-breakpoint
CREATE UNIQUE INDEX "runtime_quota_policies_workspace_id_unique" ON "runtime_quota_policies" USING btree ("workspace_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "runtime_quota_policies_active_workspace_identity_unique" ON "runtime_quota_policies" USING btree ("workspace_id","kind","boundary","dimension","unit","window","timezone","reservation_rule") WHERE "runtime_quota_policies"."status" = 'active' and "runtime_quota_policies"."principal_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "runtime_quota_policies_active_principal_identity_unique" ON "runtime_quota_policies" USING btree ("workspace_id","principal_id","kind","boundary","dimension","unit","window","timezone","reservation_rule") WHERE "runtime_quota_policies"."status" = 'active' and "runtime_quota_policies"."principal_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "runtime_quota_policy_revisions_workspace_id_unique" ON "runtime_quota_policy_revisions" USING btree ("workspace_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "runtime_quota_policy_revisions_policy_id_unique" ON "runtime_quota_policy_revisions" USING btree ("workspace_id","policy_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "runtime_quota_policy_revisions_policy_revision_unique" ON "runtime_quota_policy_revisions" USING btree ("workspace_id","policy_id","revision");--> statement-breakpoint
CREATE INDEX "runtime_quota_reservation_events_reservation_occurred_idx" ON "runtime_quota_reservation_events" USING btree ("workspace_id","reservation_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "runtime_quota_reservations_workspace_id_unique" ON "runtime_quota_reservations" USING btree ("workspace_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "runtime_quota_reservations_transition_policy_unique" ON "runtime_quota_reservations" USING btree ("workspace_id","transition_key","policy_revision_id");--> statement-breakpoint
CREATE INDEX "runtime_quota_reservations_window_state_idx" ON "runtime_quota_reservations" USING btree ("workspace_id","window_id","state");--> statement-breakpoint
CREATE INDEX "runtime_quota_reservations_subject_idx" ON "runtime_quota_reservations" USING btree ("workspace_id","subject_kind","subject_id");--> statement-breakpoint
CREATE INDEX "runtime_quota_reservations_run_idx" ON "runtime_quota_reservations" USING btree ("workspace_id","run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "runtime_quota_waits_workspace_id_unique" ON "runtime_quota_waits" USING btree ("workspace_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "runtime_quota_waits_transition_unique" ON "runtime_quota_waits" USING btree ("workspace_id","transition_key");--> statement-breakpoint
CREATE INDEX "runtime_quota_waits_eligible_idx" ON "runtime_quota_waits" USING btree ("workspace_id","state","eligible_at","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "runtime_quota_windows_workspace_id_unique" ON "runtime_quota_windows" USING btree ("workspace_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "runtime_quota_windows_finite_window_unique" ON "runtime_quota_windows" USING btree ("workspace_id","policy_id","starts_at","ends_at") WHERE "runtime_quota_windows"."ends_at" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "runtime_quota_windows_open_window_unique" ON "runtime_quota_windows" USING btree ("workspace_id","policy_id","starts_at") WHERE "runtime_quota_windows"."ends_at" is null;--> statement-breakpoint
ALTER TABLE "runtime_quota_admin_receipts" ADD CONSTRAINT "runtime_quota_admin_receipts_workspace_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_quota_claim_receipts" ADD CONSTRAINT "runtime_quota_claim_receipts_workspace_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_quota_policies" ADD CONSTRAINT "runtime_quota_policies_workspace_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_quota_policies" ADD CONSTRAINT "runtime_quota_policies_principal_fk" FOREIGN KEY ("workspace_id","principal_id") REFERENCES "public"."agent_principals"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_quota_policy_revisions" ADD CONSTRAINT "runtime_quota_policy_revisions_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_quota_policy_revisions" ADD CONSTRAINT "runtime_quota_policy_revisions_policy_fk" FOREIGN KEY ("workspace_id","policy_id") REFERENCES "public"."runtime_quota_policies"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_quota_policy_revisions" ADD CONSTRAINT "runtime_quota_policy_revisions_principal_fk" FOREIGN KEY ("workspace_id","principal_id") REFERENCES "public"."agent_principals"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_quota_reservation_events" ADD CONSTRAINT "runtime_quota_reservation_events_reservation_fk" FOREIGN KEY ("workspace_id","reservation_id") REFERENCES "public"."runtime_quota_reservations"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_quota_reservations" ADD CONSTRAINT "runtime_quota_reservations_run_fk" FOREIGN KEY ("workspace_id","run_id") REFERENCES "public"."workflow_runs"("workspace_id","id") ON DELETE restrict ON UPDATE no action DEFERRABLE INITIALLY DEFERRED;--> statement-breakpoint
ALTER TABLE "runtime_quota_reservations" ADD CONSTRAINT "runtime_quota_reservations_policy_fk" FOREIGN KEY ("workspace_id","policy_id") REFERENCES "public"."runtime_quota_policies"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_quota_reservations" ADD CONSTRAINT "runtime_quota_reservations_revision_fk" FOREIGN KEY ("workspace_id","policy_revision_id") REFERENCES "public"."runtime_quota_policy_revisions"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_quota_reservations" ADD CONSTRAINT "runtime_quota_reservations_window_fk" FOREIGN KEY ("workspace_id","window_id") REFERENCES "public"."runtime_quota_windows"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_quota_reservations" ADD CONSTRAINT "runtime_quota_reservations_admitted_principal_fk" FOREIGN KEY ("workspace_id","admitted_principal_id") REFERENCES "public"."agent_principals"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_quota_reservations" ADD CONSTRAINT "runtime_quota_reservations_principal_fk" FOREIGN KEY ("workspace_id","principal_id") REFERENCES "public"."agent_principals"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_quota_transition_receipts" ADD CONSTRAINT "runtime_quota_transition_receipts_workspace_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_quota_usage_reconciliation_receipts" ADD CONSTRAINT "runtime_quota_usage_reconciliation_receipts_workspace_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_quota_waits" ADD CONSTRAINT "runtime_quota_waits_run_fk" FOREIGN KEY ("workspace_id","run_id") REFERENCES "public"."workflow_runs"("workspace_id","id") ON DELETE restrict ON UPDATE no action DEFERRABLE INITIALLY DEFERRED;--> statement-breakpoint
ALTER TABLE "runtime_quota_waits" ADD CONSTRAINT "runtime_quota_waits_principal_fk" FOREIGN KEY ("workspace_id","admitted_principal_id") REFERENCES "public"."agent_principals"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_quota_windows" ADD CONSTRAINT "runtime_quota_windows_policy_fk" FOREIGN KEY ("workspace_id","policy_id") REFERENCES "public"."runtime_quota_policies"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_quota_policies" ADD CONSTRAINT "runtime_quota_policies_current_revision_fk" FOREIGN KEY ("workspace_id","id","current_revision_id") REFERENCES "public"."runtime_quota_policy_revisions"("workspace_id","policy_id","id") ON DELETE restrict ON UPDATE no action DEFERRABLE INITIALLY DEFERRED;--> statement-breakpoint
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
          and "workflow_runs"."failure_code" = 'QUOTA_WAIT'
          and "workflow_runs"."completed_at" is null
          and "workflow_runs"."output" is null
          and "workflow_runs"."final_snapshot" is null
          and "workflow_runs"."final_snapshot_digest" is null
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

CREATE FUNCTION runtime_quota_reject_append_only_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = 'integrity_constraint_violation';
END;
$$;--> statement-breakpoint

CREATE TRIGGER runtime_quota_policy_revisions_append_only BEFORE UPDATE OR DELETE ON runtime_quota_policy_revisions
FOR EACH ROW EXECUTE FUNCTION runtime_quota_reject_append_only_mutation();--> statement-breakpoint

CREATE FUNCTION runtime_quota_guard_policy_revision_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  quota_policy runtime_quota_policies%ROWTYPE;
BEGIN
  SELECT * INTO quota_policy
  FROM runtime_quota_policies
  WHERE workspace_id = NEW.workspace_id AND id = NEW.policy_id;
  IF NOT FOUND
     OR quota_policy.principal_id IS DISTINCT FROM NEW.principal_id
     OR quota_policy.current_revision_id IS DISTINCT FROM NEW.id THEN
    RAISE EXCEPTION 'runtime quota revision does not match its policy identity' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF quota_policy.kind IN ('concurrency', 'rate') AND NEW.exhaustion_behavior <> 'wait' THEN
    RAISE EXCEPTION 'renewable concurrency and rate quota exhaustion must wait' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF quota_policy.kind NOT IN ('concurrency', 'rate') AND NEW.exhaustion_behavior <> 'deny' THEN
    RAISE EXCEPTION 'only renewable concurrency and rate quota exhaustion may wait' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER runtime_quota_policy_revisions_insert_guard BEFORE INSERT ON runtime_quota_policy_revisions
FOR EACH ROW EXECUTE FUNCTION runtime_quota_guard_policy_revision_insert();--> statement-breakpoint
CREATE TRIGGER runtime_quota_admin_receipts_append_only BEFORE UPDATE OR DELETE ON runtime_quota_admin_receipts
FOR EACH ROW EXECUTE FUNCTION runtime_quota_reject_append_only_mutation();--> statement-breakpoint
CREATE TRIGGER runtime_quota_claim_receipts_append_only BEFORE UPDATE OR DELETE ON runtime_quota_claim_receipts
FOR EACH ROW EXECUTE FUNCTION runtime_quota_reject_append_only_mutation();--> statement-breakpoint
CREATE TRIGGER runtime_quota_transition_receipts_append_only BEFORE UPDATE OR DELETE ON runtime_quota_transition_receipts
FOR EACH ROW EXECUTE FUNCTION runtime_quota_reject_append_only_mutation();--> statement-breakpoint
CREATE TRIGGER runtime_quota_usage_reconciliation_receipts_append_only BEFORE UPDATE OR DELETE ON runtime_quota_usage_reconciliation_receipts
FOR EACH ROW EXECUTE FUNCTION runtime_quota_reject_append_only_mutation();--> statement-breakpoint
CREATE TRIGGER runtime_quota_reservation_events_append_only BEFORE UPDATE OR DELETE ON runtime_quota_reservation_events
FOR EACH ROW EXECUTE FUNCTION runtime_quota_reject_append_only_mutation();--> statement-breakpoint
CREATE TRIGGER runtime_quota_windows_append_only BEFORE UPDATE OR DELETE ON runtime_quota_windows
FOR EACH ROW EXECUTE FUNCTION runtime_quota_reject_append_only_mutation();--> statement-breakpoint

CREATE FUNCTION runtime_quota_guard_policy_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'runtime quota policies cannot be deleted' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF ROW(NEW.id, NEW.workspace_id, NEW.principal_id, NEW.scope, NEW.kind, NEW.boundary,
         NEW.dimension, NEW.unit, NEW.window, NEW.timezone, NEW.reservation_rule, NEW.created_at)
     IS DISTINCT FROM
     ROW(OLD.id, OLD.workspace_id, OLD.principal_id, OLD.scope, OLD.kind, OLD.boundary,
         OLD.dimension, OLD.unit, OLD.window, OLD.timezone, OLD.reservation_rule, OLD.created_at)
     OR NEW.policy - ARRAY['status','currentRevisionId','updatedAt']
        IS DISTINCT FROM OLD.policy - ARRAY['status','currentRevisionId','updatedAt'] THEN
    RAISE EXCEPTION 'runtime quota policy identity is immutable' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF OLD.status = 'revoked' AND NEW.status <> 'revoked' THEN
    RAISE EXCEPTION 'revoked runtime quota policies cannot be reactivated' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF NEW.updated_at < OLD.updated_at THEN
    RAISE EXCEPTION 'runtime quota policy updated_at cannot move backwards' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER runtime_quota_policies_guard BEFORE UPDATE OR DELETE ON runtime_quota_policies
FOR EACH ROW EXECUTE FUNCTION runtime_quota_guard_policy_mutation();--> statement-breakpoint

CREATE FUNCTION runtime_quota_guard_reservation_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'runtime quota reservations cannot be deleted' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF ROW(NEW.id, NEW.workspace_id, NEW.admitted_principal_id, NEW.principal_id, NEW.run_id,
         NEW.transition_key, NEW.boundary, NEW.subject_kind, NEW.subject_id, NEW.policy_id,
         NEW.policy_revision_id, NEW.window_id, NEW.scope, NEW.kind, NEW.dimension, NEW.unit,
         NEW.reservation_rule, NEW.reserved_amount, NEW.created_at)
     IS DISTINCT FROM
     ROW(OLD.id, OLD.workspace_id, OLD.admitted_principal_id, OLD.principal_id, OLD.run_id,
         OLD.transition_key, OLD.boundary, OLD.subject_kind, OLD.subject_id, OLD.policy_id,
         OLD.policy_revision_id, OLD.window_id, OLD.scope, OLD.kind, OLD.dimension, OLD.unit,
         OLD.reservation_rule, OLD.reserved_amount, OLD.created_at)
     OR NEW.reservation - ARRAY['heldAmount','settledAmount','releasedAmount','overageAmount','state','updatedAt']
        IS DISTINCT FROM OLD.reservation - ARRAY['heldAmount','settledAmount','releasedAmount','overageAmount','state','updatedAt'] THEN
    RAISE EXCEPTION 'runtime quota reservation identity is immutable' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF NEW.settled_amount::numeric < OLD.settled_amount::numeric
     OR NEW.released_amount::numeric < OLD.released_amount::numeric
     OR NEW.overage_amount::numeric < OLD.overage_amount::numeric
     OR NEW.held_amount::numeric > OLD.held_amount::numeric
     OR NEW.updated_at < OLD.updated_at THEN
    RAISE EXCEPTION 'runtime quota reservation amounts and time must advance monotonically' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF OLD.state = 'released' AND NEW.state <> 'released' THEN
    RAISE EXCEPTION 'released runtime quota reservations cannot be reopened' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER runtime_quota_reservations_guard BEFORE UPDATE OR DELETE ON runtime_quota_reservations
FOR EACH ROW EXECUTE FUNCTION runtime_quota_guard_reservation_mutation();--> statement-breakpoint

CREATE FUNCTION runtime_quota_guard_wait_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'runtime quota waits cannot be deleted' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF ROW(NEW.id, NEW.workspace_id, NEW.admitted_principal_id, NEW.run_id, NEW.transition_key,
         NEW.eligible_at, NEW.reason_code, NEW.created_at)
     IS DISTINCT FROM
     ROW(OLD.id, OLD.workspace_id, OLD.admitted_principal_id, OLD.run_id, OLD.transition_key,
         OLD.eligible_at, OLD.reason_code, OLD.created_at)
     OR NEW.wait - ARRAY['state','resumeReason','resumedBy','resumeIdempotencyKey','resolutionReservationIds','resolvedAt']
        IS DISTINCT FROM OLD.wait - ARRAY['state','resumeReason','resumedBy','resumeIdempotencyKey','resolutionReservationIds','resolvedAt'] THEN
    RAISE EXCEPTION 'runtime quota wait evidence and identity are immutable' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF OLD.state <> 'waiting' AND NEW.state <> OLD.state THEN
    RAISE EXCEPTION 'resolved runtime quota waits cannot transition again' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF OLD.state <> 'waiting' AND (
       NEW.wait->'resumedBy' IS DISTINCT FROM OLD.wait->'resumedBy'
       OR NEW.wait->'resumeReason' IS DISTINCT FROM OLD.wait->'resumeReason'
       OR NEW.wait->'resumeIdempotencyKey' IS DISTINCT FROM OLD.wait->'resumeIdempotencyKey'
       OR NEW.wait->'resolutionReservationIds' IS DISTINCT FROM OLD.wait->'resolutionReservationIds'
       OR NEW.resolved_at IS DISTINCT FROM OLD.resolved_at
     ) THEN
    RAISE EXCEPTION 'resolved runtime quota wait resolution evidence is immutable' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF NEW.state = 'waiting' AND NEW.resolved_at IS NOT NULL THEN
    RAISE EXCEPTION 'waiting runtime quota waits cannot be resolved' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF NEW.state <> 'waiting' AND NEW.resolved_at IS NULL THEN
    RAISE EXCEPTION 'resolved runtime quota waits require resolved_at' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER runtime_quota_waits_guard BEFORE UPDATE OR DELETE ON runtime_quota_waits
FOR EACH ROW EXECUTE FUNCTION runtime_quota_guard_wait_mutation();
