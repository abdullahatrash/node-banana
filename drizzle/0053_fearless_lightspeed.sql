CREATE TYPE "public"."brand_analysis_stage" AS ENUM('queued', 'fetching_source', 'extracting', 'generating_profile', 'generating_first_value', 'ready');--> statement-breakpoint
CREATE TYPE "public"."brand_analysis_status" AS ENUM('queued', 'running', 'ready', 'failed_retryable', 'failed_terminal');--> statement-breakpoint
CREATE TYPE "public"."brand_profile_status" AS ENUM('draft', 'active', 'superseded');--> statement-breakpoint
CREATE TYPE "public"."brand_source_kind" AS ENUM('website', 'description');--> statement-breakpoint
CREATE TYPE "public"."onboarding_status" AS ENUM('not_started', 'in_progress', 'ready', 'completed', 'completed_legacy');--> statement-breakpoint
CREATE TYPE "public"."onboarding_step" AS ENUM('identity', 'brand_source', 'company_stage', 'role', 'business_classification', 'goals', 'attribution', 'review', 'education');--> statement-breakpoint
CREATE TABLE "brand_analysis_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"source_id" text NOT NULL,
	"retry_of_run_id" text,
	"status" "brand_analysis_status" DEFAULT 'queued' NOT NULL,
	"stage" "brand_analysis_stage" DEFAULT 'queued' NOT NULL,
	"idempotency_key" text NOT NULL,
	"error_code" text,
	"error_message" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "brand_profiles" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"revision" integer NOT NULL,
	"status" "brand_profile_status" DEFAULT 'draft' NOT NULL,
	"schema_version" integer DEFAULT 1 NOT NULL,
	"profile" jsonb NOT NULL,
	"generated_from_run_id" text NOT NULL,
	"accepted_by_user_id" text,
	"accepted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "brand_profiles_revision_check" CHECK ("brand_profiles"."revision" > 0),
	CONSTRAINT "brand_profiles_schema_version_check" CHECK ("brand_profiles"."schema_version" = 1)
);
--> statement-breakpoint
CREATE TABLE "brand_sources" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"revision" integer NOT NULL,
	"kind" "brand_source_kind" NOT NULL,
	"submitted_url" text,
	"final_url" text,
	"submitted_description" text,
	"cleaned_text" text,
	"content_hash" text,
	"source_language" text,
	"extracted_bytes" integer,
	"fetched_at" timestamp with time zone,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "brand_sources_revision_check" CHECK ("brand_sources"."revision" > 0),
	CONSTRAINT "brand_sources_extracted_bytes_check" CHECK ("brand_sources"."extracted_bytes" is null or ("brand_sources"."extracted_bytes" >= 0 and "brand_sources"."extracted_bytes" <= 6291456)),
	CONSTRAINT "brand_sources_shape_check" CHECK (("brand_sources"."kind" = 'website' and "brand_sources"."submitted_url" is not null and "brand_sources"."submitted_description" is null) or ("brand_sources"."kind" = 'description' and "brand_sources"."submitted_description" is not null and "brand_sources"."submitted_url" is null))
);
--> statement-breakpoint
CREATE TABLE "onboarding_activation_artifacts" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"brand_profile_id" text NOT NULL,
	"schema_version" integer DEFAULT 1 NOT NULL,
	"artifact" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "onboarding_activation_artifacts_schema_version_check" CHECK ("onboarding_activation_artifacts"."schema_version" = 1)
);
--> statement-breakpoint
CREATE TABLE "onboarding_command_receipts" (
	"user_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"command_type" text NOT NULL,
	"request_fingerprint" text NOT NULL,
	"session_revision" integer NOT NULL,
	"result" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "onboarding_command_receipts_pk" PRIMARY KEY("user_id","idempotency_key"),
	CONSTRAINT "onboarding_command_receipts_fingerprint_check" CHECK ("onboarding_command_receipts"."request_fingerprint" ~ '^sha256:[a-f0-9]{64}$'),
	CONSTRAINT "onboarding_command_receipts_revision_check" CHECK ("onboarding_command_receipts"."session_revision" > 0)
);
--> statement-breakpoint
CREATE TABLE "onboarding_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"workspace_id" text,
	"status" "onboarding_status" DEFAULT 'not_started' NOT NULL,
	"current_step" "onboarding_step" DEFAULT 'identity' NOT NULL,
	"answers" jsonb NOT NULL,
	"content_language" text DEFAULT 'ar' NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "onboarding_sessions_revision_check" CHECK ("onboarding_sessions"."revision" >= 0)
);
--> statement-breakpoint
CREATE TABLE "user_preferences" (
	"user_id" text PRIMARY KEY NOT NULL,
	"interface_locale" text DEFAULT 'ar' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_preferences_interface_locale_check" CHECK ("user_preferences"."interface_locale" in ('ar', 'en'))
);
--> statement-breakpoint
ALTER TABLE "workspace_settings" ADD COLUMN "default_content_language" text DEFAULT 'ar' NOT NULL;--> statement-breakpoint
ALTER TABLE "brand_analysis_runs" ADD CONSTRAINT "brand_analysis_runs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_analysis_runs" ADD CONSTRAINT "brand_analysis_runs_source_id_brand_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."brand_sources"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_profiles" ADD CONSTRAINT "brand_profiles_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_profiles" ADD CONSTRAINT "brand_profiles_generated_from_run_id_brand_analysis_runs_id_fk" FOREIGN KEY ("generated_from_run_id") REFERENCES "public"."brand_analysis_runs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_profiles" ADD CONSTRAINT "brand_profiles_accepted_by_user_id_user_id_fk" FOREIGN KEY ("accepted_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_sources" ADD CONSTRAINT "brand_sources_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_sources" ADD CONSTRAINT "brand_sources_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_activation_artifacts" ADD CONSTRAINT "onboarding_activation_artifacts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_activation_artifacts" ADD CONSTRAINT "onboarding_activation_artifacts_brand_profile_id_brand_profiles_id_fk" FOREIGN KEY ("brand_profile_id") REFERENCES "public"."brand_profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_command_receipts" ADD CONSTRAINT "onboarding_command_receipts_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_sessions" ADD CONSTRAINT "onboarding_sessions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_sessions" ADD CONSTRAINT "onboarding_sessions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "brand_analysis_runs_workspace_idempotency_unique" ON "brand_analysis_runs" USING btree ("workspace_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "brand_analysis_runs_workspace_status_idx" ON "brand_analysis_runs" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE INDEX "brand_analysis_runs_source_idx" ON "brand_analysis_runs" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "brand_analysis_runs_retry_idx" ON "brand_analysis_runs" USING btree ("retry_of_run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "brand_profiles_workspace_revision_unique" ON "brand_profiles" USING btree ("workspace_id","revision");--> statement-breakpoint
CREATE UNIQUE INDEX "brand_profiles_active_workspace_unique" ON "brand_profiles" USING btree ("workspace_id") WHERE "brand_profiles"."status" = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX "brand_profiles_run_unique" ON "brand_profiles" USING btree ("generated_from_run_id");--> statement-breakpoint
CREATE INDEX "brand_profiles_accepted_by_idx" ON "brand_profiles" USING btree ("accepted_by_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "brand_sources_workspace_revision_unique" ON "brand_sources" USING btree ("workspace_id","revision");--> statement-breakpoint
CREATE INDEX "brand_sources_workspace_created_idx" ON "brand_sources" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "brand_sources_created_by_idx" ON "brand_sources" USING btree ("created_by_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "onboarding_activation_artifacts_workspace_profile_unique" ON "onboarding_activation_artifacts" USING btree ("workspace_id","brand_profile_id");--> statement-breakpoint
CREATE INDEX "onboarding_activation_artifacts_profile_idx" ON "onboarding_activation_artifacts" USING btree ("brand_profile_id");--> statement-breakpoint
CREATE UNIQUE INDEX "onboarding_sessions_user_unique" ON "onboarding_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "onboarding_sessions_workspace_idx" ON "onboarding_sessions" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "onboarding_sessions_status_idx" ON "onboarding_sessions" USING btree ("status");