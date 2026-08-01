CREATE TABLE "runtime_budget_admin_receipts" (
	"workspace_id" text NOT NULL,
	"kind" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_digest" text NOT NULL,
	"resource_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "runtime_budget_admin_receipts_pk" PRIMARY KEY("workspace_id","kind","idempotency_key"),
	CONSTRAINT "runtime_budget_admin_receipts_kind_check" CHECK ("runtime_budget_admin_receipts"."kind" in ('policy_revision', 'pricing_override')),
	CONSTRAINT "runtime_budget_admin_receipts_digest_check" CHECK ("runtime_budget_admin_receipts"."request_digest" ~ '^sha256:[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE TABLE "runtime_budget_admission_grants" (
	"workspace_id" text NOT NULL,
	"run_id" text NOT NULL,
	"grant_id" text NOT NULL,
	"reserved_cents" integer,
	"currency" text,
	"exposure_digest" text NOT NULL,
	CONSTRAINT "runtime_budget_admission_grants_pk" PRIMARY KEY("workspace_id","run_id","grant_id"),
	CONSTRAINT "runtime_budget_admission_grants_capacity_check" CHECK (("runtime_budget_admission_grants"."reserved_cents" is null and "runtime_budget_admission_grants"."currency" is null) or ("runtime_budget_admission_grants"."reserved_cents" >= 0 and "runtime_budget_admission_grants"."currency" = 'USD')),
	CONSTRAINT "runtime_budget_admission_grants_digest_check" CHECK ("runtime_budget_admission_grants"."exposure_digest" ~ '^sha256:[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE TABLE "runtime_budget_admissions" (
	"workspace_id" text NOT NULL,
	"run_id" text NOT NULL,
	"principal_id" text NOT NULL,
	"request_digest" text NOT NULL,
	"grant_ids" jsonb NOT NULL,
	"step_exposures" jsonb NOT NULL,
	"admission" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "runtime_budget_admissions_pk" PRIMARY KEY("workspace_id","run_id"),
	CONSTRAINT "runtime_budget_admissions_digest_check" CHECK ("runtime_budget_admissions"."request_digest" ~ '^sha256:[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE TABLE "runtime_budget_attempt_allocations" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"principal_id" text NOT NULL,
	"run_id" text NOT NULL,
	"step_attempt_id" text NOT NULL,
	"step_id" text NOT NULL,
	"attempt" integer NOT NULL,
	"effect_key" text NOT NULL,
	"credential_effect_ref" text NOT NULL,
	"provider" text NOT NULL,
	"provider_operation" text NOT NULL,
	"model" text NOT NULL,
	"source_amount" text,
	"source_currency" text,
	"grant_id" text,
	"grant_amount_cents" integer,
	"request_digest" text NOT NULL,
	"allocation" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "runtime_budget_attempt_allocations_attempt_check" CHECK ("runtime_budget_attempt_allocations"."attempt" > 0),
	CONSTRAINT "runtime_budget_attempt_allocations_amount_check" CHECK (("runtime_budget_attempt_allocations"."source_amount" is null and "runtime_budget_attempt_allocations"."source_currency" is null) or ("runtime_budget_attempt_allocations"."source_amount" ~ '^(0|[1-9][0-9]*)(\.[0-9]+)?$' and "runtime_budget_attempt_allocations"."source_currency" ~ '^[A-Z]{3}$')),
	CONSTRAINT "runtime_budget_attempt_allocations_grant_amount_check" CHECK (("runtime_budget_attempt_allocations"."grant_id" is null and "runtime_budget_attempt_allocations"."grant_amount_cents" is null) or ("runtime_budget_attempt_allocations"."grant_id" is not null and "runtime_budget_attempt_allocations"."grant_amount_cents" >= 0)),
	CONSTRAINT "runtime_budget_attempt_allocations_digest_check" CHECK ("runtime_budget_attempt_allocations"."request_digest" ~ '^sha256:[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE TABLE "runtime_budget_attempt_reservation_allocations" (
	"workspace_id" text NOT NULL,
	"allocation_id" text NOT NULL,
	"reservation_id" text NOT NULL,
	"amount" text,
	"currency" text NOT NULL,
	"basis" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "runtime_budget_attempt_reservation_allocations_pk" PRIMARY KEY("workspace_id","allocation_id","reservation_id"),
	CONSTRAINT "runtime_budget_attempt_reservation_allocations_value_check" CHECK (("runtime_budget_attempt_reservation_allocations"."basis" = 'exact' and "runtime_budget_attempt_reservation_allocations"."amount" ~ '^(0|[1-9][0-9]*)(\.[0-9]+)?$') or ("runtime_budget_attempt_reservation_allocations"."basis" = 'envelope_bound' and "runtime_budget_attempt_reservation_allocations"."amount" is null)),
	CONSTRAINT "runtime_budget_attempt_reservation_allocations_currency_check" CHECK ("runtime_budget_attempt_reservation_allocations"."currency" ~ '^[A-Z]{3}$')
);
--> statement-breakpoint
CREATE TABLE "runtime_budget_periods" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"policy_id" text NOT NULL,
	"kind" text NOT NULL,
	"timezone" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "runtime_budget_periods_interval_check" CHECK (("runtime_budget_periods"."kind" = 'lifetime' and "runtime_budget_periods"."ends_at" is null) or ("runtime_budget_periods"."kind" in ('calendar_day', 'calendar_week', 'calendar_month') and "runtime_budget_periods"."ends_at" > "runtime_budget_periods"."starts_at"))
);
--> statement-breakpoint
CREATE TABLE "runtime_budget_policies" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"principal_id" text,
	"scope" text NOT NULL,
	"currency" text NOT NULL,
	"period" text NOT NULL,
	"timezone" text NOT NULL,
	"status" text NOT NULL,
	"current_revision_id" text NOT NULL,
	"policy" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "runtime_budget_policies_identity_check" CHECK (("runtime_budget_policies"."scope" = 'workspace' and "runtime_budget_policies"."principal_id" is null) or ("runtime_budget_policies"."scope" = 'principal' and "runtime_budget_policies"."principal_id" is not null)),
	CONSTRAINT "runtime_budget_policies_value_check" CHECK ("runtime_budget_policies"."scope" in ('workspace', 'principal') and "runtime_budget_policies"."status" in ('active', 'revoked') and "runtime_budget_policies"."currency" ~ '^[A-Z]{3}$' and "runtime_budget_policies"."period" in ('calendar_day', 'calendar_week', 'calendar_month', 'lifetime') and length("runtime_budget_policies"."timezone") between 1 and 255)
);
--> statement-breakpoint
CREATE TABLE "runtime_budget_policy_revisions" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"policy_id" text NOT NULL,
	"principal_id" text,
	"revision" integer NOT NULL,
	"warning_threshold" text NOT NULL,
	"hard_limit" text NOT NULL,
	"unknown_price_treatment" text NOT NULL,
	"unknown_price_allowance" text,
	"created_by_user_id" text NOT NULL,
	"revision_record" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "runtime_budget_policy_revisions_revision_check" CHECK ("runtime_budget_policy_revisions"."revision" > 0),
	CONSTRAINT "runtime_budget_policy_revisions_decimal_check" CHECK ("runtime_budget_policy_revisions"."warning_threshold" ~ '^(0|[1-9][0-9]*)(\.[0-9]+)?$' and "runtime_budget_policy_revisions"."hard_limit" ~ '^[1-9][0-9]*(\.[0-9]+)?$' and "runtime_budget_policy_revisions"."warning_threshold"::numeric <= "runtime_budget_policy_revisions"."hard_limit"::numeric and ("runtime_budget_policy_revisions"."unknown_price_allowance" is null or "runtime_budget_policy_revisions"."unknown_price_allowance" ~ '^[1-9][0-9]*(\.[0-9]+)?$')),
	CONSTRAINT "runtime_budget_policy_revisions_unknown_check" CHECK (("runtime_budget_policy_revisions"."unknown_price_treatment" = 'deny' and "runtime_budget_policy_revisions"."unknown_price_allowance" is null) or ("runtime_budget_policy_revisions"."unknown_price_treatment" = 'fixed_allowance' and "runtime_budget_policy_revisions"."unknown_price_allowance" is not null))
);
--> statement-breakpoint
CREATE TABLE "runtime_budget_reservation_events" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"reservation_id" text NOT NULL,
	"run_id" text NOT NULL,
	"settlement_id" text,
	"cost_valuation_id" text,
	"event_type" text NOT NULL,
	"amount" text,
	"currency" text,
	"event" jsonb NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	CONSTRAINT "runtime_budget_reservation_events_event_check" CHECK ("runtime_budget_reservation_events"."event_type" in ('held', 'settled', 'released', 'outcome_unknown', 'held_unknown_cost') and (("runtime_budget_reservation_events"."amount" is null and "runtime_budget_reservation_events"."currency" is null) or ("runtime_budget_reservation_events"."amount" ~ '^(0|[1-9][0-9]*)(\.[0-9]+)?$' and "runtime_budget_reservation_events"."currency" ~ '^[A-Z]{3}$')))
);
--> statement-breakpoint
CREATE TABLE "runtime_budget_reservations" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"admitted_principal_id" text NOT NULL,
	"principal_id" text,
	"run_id" text NOT NULL,
	"policy_id" text NOT NULL,
	"policy_revision_id" text NOT NULL,
	"period_id" text NOT NULL,
	"scope" text NOT NULL,
	"currency" text NOT NULL,
	"reserved_amount" text NOT NULL,
	"held_amount" text NOT NULL,
	"settled_amount" text NOT NULL,
	"released_amount" text NOT NULL,
	"state" text NOT NULL,
	"pricing_snapshot_ids" jsonb NOT NULL,
	"reservation" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "runtime_budget_reservations_scope_check" CHECK (("runtime_budget_reservations"."scope" = 'workspace' and "runtime_budget_reservations"."principal_id" is null) or ("runtime_budget_reservations"."scope" = 'principal' and "runtime_budget_reservations"."principal_id" is not null)),
	CONSTRAINT "runtime_budget_reservations_amount_check" CHECK ("runtime_budget_reservations"."reserved_amount" ~ '^(0|[1-9][0-9]*)(\.[0-9]+)?$' and "runtime_budget_reservations"."held_amount" ~ '^(0|[1-9][0-9]*)(\.[0-9]+)?$' and "runtime_budget_reservations"."settled_amount" ~ '^(0|[1-9][0-9]*)(\.[0-9]+)?$' and "runtime_budget_reservations"."released_amount" ~ '^(0|[1-9][0-9]*)(\.[0-9]+)?$' and "runtime_budget_reservations"."held_amount"::numeric <= "runtime_budget_reservations"."reserved_amount"::numeric and "runtime_budget_reservations"."released_amount"::numeric <= "runtime_budget_reservations"."reserved_amount"::numeric),
	CONSTRAINT "runtime_budget_reservations_state_check" CHECK ("runtime_budget_reservations"."state" in ('held', 'settled', 'released', 'outcome_unknown', 'held_unknown_cost') and "runtime_budget_reservations"."currency" ~ '^[A-Z]{3}$')
);
--> statement-breakpoint
CREATE TABLE "runtime_budget_settlement_receipts" (
	"workspace_id" text NOT NULL,
	"cost_valuation_id" text NOT NULL,
	"run_id" text NOT NULL,
	"request_digest" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "runtime_budget_settlement_receipts_pk" PRIMARY KEY("workspace_id","cost_valuation_id")
);
--> statement-breakpoint
CREATE TABLE "runtime_spend_control_events" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"revision" integer NOT NULL,
	"suspended" boolean NOT NULL,
	"reason" text NOT NULL,
	"actor_user_id" text NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	CONSTRAINT "runtime_spend_control_events_value_check" CHECK ("runtime_spend_control_events"."revision" > 0 and length("runtime_spend_control_events"."reason") between 1 and 500)
);
--> statement-breakpoint
CREATE TABLE "runtime_spend_controls" (
	"workspace_id" text PRIMARY KEY NOT NULL,
	"suspended" boolean NOT NULL,
	"revision" integer NOT NULL,
	"reason" text NOT NULL,
	"updated_by_user_id" text NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "runtime_spend_controls_revision_check" CHECK ("runtime_spend_controls"."revision" > 0 and length("runtime_spend_controls"."reason") between 1 and 500)
);
--> statement-breakpoint
CREATE TABLE "runtime_workspace_pricing_override_revisions" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"override_id" text NOT NULL,
	"revision" integer NOT NULL,
	"event_type" text NOT NULL,
	"override" jsonb NOT NULL,
	"actor_user_id" text NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	CONSTRAINT "runtime_workspace_pricing_override_revisions_event_check" CHECK ("runtime_workspace_pricing_override_revisions"."event_type" in ('created', 'revoked') and "runtime_workspace_pricing_override_revisions"."revision" > 0)
);
--> statement-breakpoint
CREATE TABLE "runtime_workspace_pricing_overrides" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"provider" text NOT NULL,
	"provider_operation" text NOT NULL,
	"model" text NOT NULL,
	"service_tier" text NOT NULL,
	"dimension" text NOT NULL,
	"unit" text NOT NULL,
	"price" text NOT NULL,
	"currency" text NOT NULL,
	"per_quantity" text NOT NULL,
	"run_ceiling" text NOT NULL,
	"source_ref" text NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"status" text NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_by_user_id" text,
	"override" jsonb NOT NULL,
	CONSTRAINT "runtime_workspace_pricing_overrides_decimal_check" CHECK ("runtime_workspace_pricing_overrides"."price" ~ '^(0|[1-9][0-9]*)(\.[0-9]+)?$' and "runtime_workspace_pricing_overrides"."per_quantity" ~ '^[1-9][0-9]*(\.[0-9]+)?$' and "runtime_workspace_pricing_overrides"."run_ceiling" ~ '^[1-9][0-9]*(\.[0-9]+)?$' and "runtime_workspace_pricing_overrides"."currency" ~ '^[A-Z]{3}$')
);
--> statement-breakpoint
ALTER TABLE "runtime_cost_valuations" DROP CONSTRAINT "runtime_cost_valuations_state_check";--> statement-breakpoint
ALTER TABLE "runtime_budget_admin_receipts" ADD CONSTRAINT "runtime_budget_admin_receipts_workspace_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_budget_admission_grants" ADD CONSTRAINT "runtime_budget_admission_grants_admission_fk" FOREIGN KEY ("workspace_id","run_id") REFERENCES "public"."runtime_budget_admissions"("workspace_id","run_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_budget_admission_grants" ADD CONSTRAINT "runtime_budget_admission_grants_grant_fk" FOREIGN KEY ("grant_id") REFERENCES "public"."credential_spend_grants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_budget_admissions" ADD CONSTRAINT "runtime_budget_admissions_run_fk" FOREIGN KEY ("workspace_id","run_id") REFERENCES "public"."workflow_runs"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_budget_admissions" ADD CONSTRAINT "runtime_budget_admissions_principal_fk" FOREIGN KEY ("workspace_id","principal_id") REFERENCES "public"."agent_principals"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_budget_attempt_allocations" ADD CONSTRAINT "runtime_budget_attempt_allocations_admission_fk" FOREIGN KEY ("workspace_id","run_id") REFERENCES "public"."runtime_budget_admissions"("workspace_id","run_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_budget_attempt_allocations" ADD CONSTRAINT "runtime_budget_attempt_allocations_attempt_fk" FOREIGN KEY ("workspace_id","run_id","step_attempt_id") REFERENCES "public"."workflow_step_attempts"("workspace_id","run_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_budget_attempt_allocations" ADD CONSTRAINT "runtime_budget_attempt_allocations_principal_fk" FOREIGN KEY ("workspace_id","principal_id") REFERENCES "public"."agent_principals"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_budget_attempt_allocations" ADD CONSTRAINT "runtime_budget_attempt_allocations_grant_fk" FOREIGN KEY ("grant_id") REFERENCES "public"."credential_spend_grants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_budget_attempt_reservation_allocations" ADD CONSTRAINT "runtime_budget_attempt_reservation_allocations_allocation_fk" FOREIGN KEY ("workspace_id","allocation_id") REFERENCES "public"."runtime_budget_attempt_allocations"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_budget_attempt_reservation_allocations" ADD CONSTRAINT "runtime_budget_attempt_reservation_allocations_reservation_fk" FOREIGN KEY ("workspace_id","reservation_id") REFERENCES "public"."runtime_budget_reservations"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_budget_periods" ADD CONSTRAINT "runtime_budget_periods_policy_fk" FOREIGN KEY ("workspace_id","policy_id") REFERENCES "public"."runtime_budget_policies"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_budget_policies" ADD CONSTRAINT "runtime_budget_policies_workspace_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_budget_policies" ADD CONSTRAINT "runtime_budget_policies_principal_fk" FOREIGN KEY ("workspace_id","principal_id") REFERENCES "public"."agent_principals"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_budget_policy_revisions" ADD CONSTRAINT "runtime_budget_policy_revisions_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_budget_policy_revisions" ADD CONSTRAINT "runtime_budget_policy_revisions_policy_fk" FOREIGN KEY ("workspace_id","policy_id") REFERENCES "public"."runtime_budget_policies"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_budget_policy_revisions" ADD CONSTRAINT "runtime_budget_policy_revisions_principal_fk" FOREIGN KEY ("workspace_id","principal_id") REFERENCES "public"."agent_principals"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_budget_reservation_events" ADD CONSTRAINT "runtime_budget_reservation_events_reservation_fk" FOREIGN KEY ("workspace_id","reservation_id") REFERENCES "public"."runtime_budget_reservations"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_budget_reservation_events" ADD CONSTRAINT "runtime_budget_reservation_events_valuation_fk" FOREIGN KEY ("workspace_id","cost_valuation_id") REFERENCES "public"."runtime_cost_valuations"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_budget_reservations" ADD CONSTRAINT "runtime_budget_reservations_admission_fk" FOREIGN KEY ("workspace_id","run_id") REFERENCES "public"."runtime_budget_admissions"("workspace_id","run_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_budget_reservations" ADD CONSTRAINT "runtime_budget_reservations_policy_fk" FOREIGN KEY ("workspace_id","policy_id") REFERENCES "public"."runtime_budget_policies"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_budget_reservations" ADD CONSTRAINT "runtime_budget_reservations_revision_fk" FOREIGN KEY ("workspace_id","policy_revision_id") REFERENCES "public"."runtime_budget_policy_revisions"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_budget_reservations" ADD CONSTRAINT "runtime_budget_reservations_period_fk" FOREIGN KEY ("workspace_id","period_id") REFERENCES "public"."runtime_budget_periods"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_budget_reservations" ADD CONSTRAINT "runtime_budget_reservations_principal_fk" FOREIGN KEY ("workspace_id","principal_id") REFERENCES "public"."agent_principals"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_budget_reservations" ADD CONSTRAINT "runtime_budget_reservations_admitted_principal_fk" FOREIGN KEY ("workspace_id","admitted_principal_id") REFERENCES "public"."agent_principals"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_budget_settlement_receipts" ADD CONSTRAINT "runtime_budget_settlement_receipts_valuation_fk" FOREIGN KEY ("workspace_id","cost_valuation_id") REFERENCES "public"."runtime_cost_valuations"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_spend_control_events" ADD CONSTRAINT "runtime_spend_control_events_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_spend_control_events" ADD CONSTRAINT "runtime_spend_control_events_workspace_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_spend_controls" ADD CONSTRAINT "runtime_spend_controls_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_spend_controls" ADD CONSTRAINT "runtime_spend_controls_updated_by_user_id_user_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_workspace_pricing_override_revisions" ADD CONSTRAINT "runtime_workspace_pricing_override_revisions_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_workspace_pricing_override_revisions" ADD CONSTRAINT "runtime_workspace_pricing_override_revisions_override_fk" FOREIGN KEY ("workspace_id","override_id") REFERENCES "public"."runtime_workspace_pricing_overrides"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_workspace_pricing_overrides" ADD CONSTRAINT "runtime_workspace_pricing_overrides_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_workspace_pricing_overrides" ADD CONSTRAINT "runtime_workspace_pricing_overrides_revoked_by_user_id_user_id_fk" FOREIGN KEY ("revoked_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_workspace_pricing_overrides" ADD CONSTRAINT "runtime_workspace_pricing_overrides_workspace_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "runtime_budget_admission_grants_grant_idx" ON "runtime_budget_admission_grants" USING btree ("grant_id");--> statement-breakpoint
CREATE INDEX "runtime_budget_admissions_principal_created_idx" ON "runtime_budget_admissions" USING btree ("workspace_id","principal_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "runtime_budget_attempt_allocations_workspace_id_unique" ON "runtime_budget_attempt_allocations" USING btree ("workspace_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "runtime_budget_attempt_allocations_attempt_unique" ON "runtime_budget_attempt_allocations" USING btree ("workspace_id","run_id","step_attempt_id");--> statement-breakpoint
CREATE INDEX "runtime_budget_attempt_allocations_run_step_idx" ON "runtime_budget_attempt_allocations" USING btree ("workspace_id","run_id","step_id","attempt");--> statement-breakpoint
CREATE INDEX "runtime_budget_attempt_allocations_grant_idx" ON "runtime_budget_attempt_allocations" USING btree ("grant_id");--> statement-breakpoint
CREATE INDEX "runtime_budget_attempt_reservation_allocations_reservation_idx" ON "runtime_budget_attempt_reservation_allocations" USING btree ("workspace_id","reservation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "runtime_budget_periods_workspace_id_unique" ON "runtime_budget_periods" USING btree ("workspace_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "runtime_budget_periods_window_unique" ON "runtime_budget_periods" USING btree ("workspace_id","policy_id","starts_at","ends_at");--> statement-breakpoint
CREATE UNIQUE INDEX "runtime_budget_policies_workspace_id_unique" ON "runtime_budget_policies" USING btree ("workspace_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "runtime_budget_policies_active_workspace_unique" ON "runtime_budget_policies" USING btree ("workspace_id") WHERE "runtime_budget_policies"."status" = 'active' and "runtime_budget_policies"."principal_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "runtime_budget_policies_active_principal_unique" ON "runtime_budget_policies" USING btree ("workspace_id","principal_id") WHERE "runtime_budget_policies"."status" = 'active' and "runtime_budget_policies"."principal_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "runtime_budget_policy_revisions_workspace_id_unique" ON "runtime_budget_policy_revisions" USING btree ("workspace_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "runtime_budget_policy_revisions_policy_revision_unique" ON "runtime_budget_policy_revisions" USING btree ("workspace_id","policy_id","revision");--> statement-breakpoint
CREATE INDEX "runtime_budget_policy_revisions_principal_idx" ON "runtime_budget_policy_revisions" USING btree ("workspace_id","principal_id");--> statement-breakpoint
CREATE INDEX "runtime_budget_reservation_events_reservation_occurred_idx" ON "runtime_budget_reservation_events" USING btree ("workspace_id","reservation_id","occurred_at");--> statement-breakpoint
CREATE INDEX "runtime_budget_reservation_events_valuation_idx" ON "runtime_budget_reservation_events" USING btree ("workspace_id","cost_valuation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "runtime_budget_reservations_workspace_id_unique" ON "runtime_budget_reservations" USING btree ("workspace_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "runtime_budget_reservations_run_policy_unique" ON "runtime_budget_reservations" USING btree ("workspace_id","run_id","policy_id");--> statement-breakpoint
CREATE INDEX "runtime_budget_reservations_period_state_idx" ON "runtime_budget_reservations" USING btree ("workspace_id","period_id","state");--> statement-breakpoint
CREATE INDEX "runtime_budget_reservations_principal_created_idx" ON "runtime_budget_reservations" USING btree ("workspace_id","admitted_principal_id","created_at");--> statement-breakpoint
CREATE INDEX "runtime_budget_reservations_revision_idx" ON "runtime_budget_reservations" USING btree ("workspace_id","policy_revision_id");--> statement-breakpoint
CREATE UNIQUE INDEX "runtime_spend_control_events_workspace_revision_unique" ON "runtime_spend_control_events" USING btree ("workspace_id","revision");--> statement-breakpoint
CREATE UNIQUE INDEX "runtime_workspace_pricing_override_revisions_unique" ON "runtime_workspace_pricing_override_revisions" USING btree ("workspace_id","override_id","revision");--> statement-breakpoint
CREATE UNIQUE INDEX "runtime_workspace_pricing_overrides_workspace_id_unique" ON "runtime_workspace_pricing_overrides" USING btree ("workspace_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "runtime_workspace_pricing_overrides_active_identity_unique" ON "runtime_workspace_pricing_overrides" USING btree ("workspace_id","provider","provider_operation","model","service_tier","dimension") WHERE "runtime_workspace_pricing_overrides"."status" = 'active';--> statement-breakpoint
ALTER TABLE "runtime_cost_valuations" ADD CONSTRAINT "runtime_cost_valuations_state_check" CHECK (("runtime_cost_valuations"."source" = 'unknown' and "runtime_cost_valuations"."amount" is null and "runtime_cost_valuations"."currency" is null)
        or ("runtime_cost_valuations"."source" = 'effect_not_created' and "runtime_cost_valuations"."amount" = '0' and "runtime_cost_valuations"."currency" is null)
        or ("runtime_cost_valuations"."source" in ('provider_reported', 'workspace_override', 'builtin_catalog', 'mixed')
          and "runtime_cost_valuations"."amount" ~ '^(0|[1-9][0-9]*)(\.[0-9]+)?$'
          and "runtime_cost_valuations"."currency" ~ '^[A-Z]{3}$'));
--> statement-breakpoint
ALTER TABLE "runtime_budget_policies" ADD CONSTRAINT "runtime_budget_policies_current_revision_fk" FOREIGN KEY ("workspace_id","current_revision_id") REFERENCES "public"."runtime_budget_policy_revisions"("workspace_id","id") ON DELETE restrict ON UPDATE no action DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION reject_runtime_budget_history_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'runtime budget history rows are append-only'; END; $$;
--> statement-breakpoint
CREATE TRIGGER runtime_budget_policy_revisions_immutable BEFORE UPDATE OR DELETE ON runtime_budget_policy_revisions FOR EACH ROW EXECUTE FUNCTION reject_runtime_budget_history_mutation();
--> statement-breakpoint
CREATE TRIGGER runtime_budget_admin_receipts_immutable BEFORE UPDATE OR DELETE ON runtime_budget_admin_receipts FOR EACH ROW EXECUTE FUNCTION reject_runtime_budget_history_mutation();
--> statement-breakpoint
CREATE TRIGGER runtime_budget_periods_immutable BEFORE UPDATE OR DELETE ON runtime_budget_periods FOR EACH ROW EXECUTE FUNCTION reject_runtime_budget_history_mutation();
--> statement-breakpoint
CREATE TRIGGER runtime_budget_admissions_immutable BEFORE UPDATE OR DELETE ON runtime_budget_admissions FOR EACH ROW EXECUTE FUNCTION reject_runtime_budget_history_mutation();
--> statement-breakpoint
CREATE TRIGGER runtime_budget_admission_grants_immutable BEFORE UPDATE OR DELETE ON runtime_budget_admission_grants FOR EACH ROW EXECUTE FUNCTION reject_runtime_budget_history_mutation();
--> statement-breakpoint
CREATE TRIGGER runtime_budget_attempt_allocations_immutable BEFORE UPDATE OR DELETE ON runtime_budget_attempt_allocations FOR EACH ROW EXECUTE FUNCTION reject_runtime_budget_history_mutation();
--> statement-breakpoint
CREATE TRIGGER runtime_budget_attempt_reservation_allocations_immutable BEFORE UPDATE OR DELETE ON runtime_budget_attempt_reservation_allocations FOR EACH ROW EXECUTE FUNCTION reject_runtime_budget_history_mutation();
--> statement-breakpoint
CREATE TRIGGER runtime_budget_reservation_events_immutable BEFORE UPDATE OR DELETE ON runtime_budget_reservation_events FOR EACH ROW EXECUTE FUNCTION reject_runtime_budget_history_mutation();
--> statement-breakpoint
CREATE TRIGGER runtime_budget_settlement_receipts_immutable BEFORE UPDATE OR DELETE ON runtime_budget_settlement_receipts FOR EACH ROW EXECUTE FUNCTION reject_runtime_budget_history_mutation();
--> statement-breakpoint
CREATE TRIGGER runtime_workspace_pricing_override_revisions_immutable BEFORE UPDATE OR DELETE ON runtime_workspace_pricing_override_revisions FOR EACH ROW EXECUTE FUNCTION reject_runtime_budget_history_mutation();
--> statement-breakpoint
CREATE TRIGGER runtime_spend_control_events_immutable BEFORE UPDATE OR DELETE ON runtime_spend_control_events FOR EACH ROW EXECUTE FUNCTION reject_runtime_budget_history_mutation();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION guard_runtime_budget_policy_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'runtime budget policy heads cannot be deleted'; END IF;
  IF ROW(NEW.id, NEW.workspace_id, NEW.principal_id, NEW.scope, NEW.currency, NEW.period, NEW.timezone, NEW.created_at) IS DISTINCT FROM ROW(OLD.id, OLD.workspace_id, OLD.principal_id, OLD.scope, OLD.currency, OLD.period, OLD.timezone, OLD.created_at) THEN RAISE EXCEPTION 'runtime budget policy identity is immutable'; END IF;
  IF OLD.status = 'revoked' AND NEW.status <> 'revoked' THEN RAISE EXCEPTION 'revoked runtime budget policies cannot be reactivated'; END IF;
  RETURN NEW;
END; $$;
--> statement-breakpoint
CREATE TRIGGER runtime_budget_policies_guard BEFORE UPDATE OR DELETE ON runtime_budget_policies FOR EACH ROW EXECUTE FUNCTION guard_runtime_budget_policy_mutation();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION guard_runtime_budget_reservation_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'runtime budget reservations cannot be deleted'; END IF;
  IF ROW(NEW.id, NEW.workspace_id, NEW.admitted_principal_id, NEW.principal_id, NEW.run_id, NEW.policy_id, NEW.policy_revision_id, NEW.period_id, NEW.scope, NEW.currency, NEW.reserved_amount, NEW.pricing_snapshot_ids, NEW.created_at) IS DISTINCT FROM ROW(OLD.id, OLD.workspace_id, OLD.admitted_principal_id, OLD.principal_id, OLD.run_id, OLD.policy_id, OLD.policy_revision_id, OLD.period_id, OLD.scope, OLD.currency, OLD.reserved_amount, OLD.pricing_snapshot_ids, OLD.created_at) THEN RAISE EXCEPTION 'runtime budget reservation identity and ceiling are immutable'; END IF;
  IF NEW.updated_at < OLD.updated_at THEN RAISE EXCEPTION 'runtime budget reservation update time is monotonic'; END IF;
  RETURN NEW;
END; $$;
--> statement-breakpoint
CREATE TRIGGER runtime_budget_reservations_guard BEFORE UPDATE OR DELETE ON runtime_budget_reservations FOR EACH ROW EXECUTE FUNCTION guard_runtime_budget_reservation_mutation();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION guard_runtime_pricing_override_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'runtime pricing override heads cannot be deleted'; END IF;
  IF ROW(NEW.id, NEW.workspace_id, NEW.provider, NEW.provider_operation, NEW.model, NEW.service_tier, NEW.dimension, NEW.unit, NEW.price, NEW.currency, NEW.per_quantity, NEW.run_ceiling, NEW.source_ref, NEW.effective_from, NEW.created_by_user_id, NEW.created_at) IS DISTINCT FROM ROW(OLD.id, OLD.workspace_id, OLD.provider, OLD.provider_operation, OLD.model, OLD.service_tier, OLD.dimension, OLD.unit, OLD.price, OLD.currency, OLD.per_quantity, OLD.run_ceiling, OLD.source_ref, OLD.effective_from, OLD.created_by_user_id, OLD.created_at) THEN RAISE EXCEPTION 'runtime pricing override identity and valuation terms are immutable'; END IF;
  IF OLD.status = 'revoked' AND NEW.status <> 'revoked' THEN RAISE EXCEPTION 'revoked runtime pricing overrides cannot be reactivated'; END IF;
  RETURN NEW;
END; $$;
--> statement-breakpoint
CREATE TRIGGER runtime_workspace_pricing_overrides_guard BEFORE UPDATE OR DELETE ON runtime_workspace_pricing_overrides FOR EACH ROW EXECUTE FUNCTION guard_runtime_pricing_override_mutation();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION guard_runtime_spend_control_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'runtime spend controls cannot be deleted'; END IF;
  IF NEW.workspace_id IS DISTINCT FROM OLD.workspace_id OR NEW.revision <> OLD.revision + 1 OR NEW.updated_at < OLD.updated_at THEN RAISE EXCEPTION 'runtime spend control revisions must advance monotonically'; END IF;
  RETURN NEW;
END; $$;
--> statement-breakpoint
CREATE TRIGGER runtime_spend_controls_guard BEFORE UPDATE OR DELETE ON runtime_spend_controls FOR EACH ROW EXECUTE FUNCTION guard_runtime_spend_control_mutation();
