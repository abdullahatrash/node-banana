CREATE TABLE "onboarding_analytics_events" (
	"id" text PRIMARY KEY NOT NULL,
	"event_name" text NOT NULL,
	"user_id" text,
	"workspace_id" text,
	"session_id" text,
	"run_id" text,
	"step" text,
	"source_kind" text,
	"stage" text,
	"interface_locale" text,
	"content_language" text,
	"duration_ms" integer,
	"failure_code" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "onboarding_analytics_event_name_check" CHECK ("onboarding_analytics_events"."event_name" in ('signup_submitted','verification_sent','verification_completed','step_viewed','step_completed','source_selected','analysis_stage_completed','analysis_failed','profile_accepted','profile_edited','first_value_viewed','onboarding_completed')),
	CONSTRAINT "onboarding_analytics_step_check" CHECK ("onboarding_analytics_events"."step" is null or "onboarding_analytics_events"."step" in ('identity','brand_source','company_stage','role','business_classification','goals','attribution','review','education')),
	CONSTRAINT "onboarding_analytics_source_kind_check" CHECK ("onboarding_analytics_events"."source_kind" is null or "onboarding_analytics_events"."source_kind" in ('website','description')),
	CONSTRAINT "onboarding_analytics_stage_check" CHECK ("onboarding_analytics_events"."stage" is null or "onboarding_analytics_events"."stage" in ('queued','fetching_source','extracting','generating_profile','generating_first_value','ready')),
	CONSTRAINT "onboarding_analytics_locale_check" CHECK ("onboarding_analytics_events"."interface_locale" is null or "onboarding_analytics_events"."interface_locale" in ('ar','en')),
	CONSTRAINT "onboarding_analytics_duration_check" CHECK ("onboarding_analytics_events"."duration_ms" is null or ("onboarding_analytics_events"."duration_ms" >= 0 and "onboarding_analytics_events"."duration_ms" <= 86400000)),
	CONSTRAINT "onboarding_analytics_failure_code_check" CHECK ("onboarding_analytics_events"."failure_code" is null or "onboarding_analytics_events"."failure_code" ~ '^[A-Z][A-Z0-9_]{0,79}$')
);
--> statement-breakpoint
ALTER TABLE "onboarding_analytics_events" ADD CONSTRAINT "onboarding_analytics_events_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_analytics_events" ADD CONSTRAINT "onboarding_analytics_events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "onboarding_analytics_event_time_idx" ON "onboarding_analytics_events" USING btree ("event_name","occurred_at");--> statement-breakpoint
CREATE INDEX "onboarding_analytics_workspace_time_idx" ON "onboarding_analytics_events" USING btree ("workspace_id","occurred_at");--> statement-breakpoint
CREATE INDEX "onboarding_analytics_user_idx" ON "onboarding_analytics_events" USING btree ("user_id");