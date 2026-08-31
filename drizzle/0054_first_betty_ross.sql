CREATE TABLE "onboarding_analysis_dispatch_intents" (
	"run_id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error_code" text,
	"dispatched_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "onboarding_analysis_dispatch_status_check" CHECK ("onboarding_analysis_dispatch_intents"."status" in ('pending', 'dispatched')),
	CONSTRAINT "onboarding_analysis_dispatch_attempts_check" CHECK ("onboarding_analysis_dispatch_intents"."attempts" >= 0)
);
--> statement-breakpoint
ALTER TABLE "onboarding_analysis_dispatch_intents" ADD CONSTRAINT "onboarding_analysis_dispatch_intents_run_id_brand_analysis_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."brand_analysis_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_analysis_dispatch_intents" ADD CONSTRAINT "onboarding_analysis_dispatch_intents_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "onboarding_analysis_dispatch_workspace_status_idx" ON "onboarding_analysis_dispatch_intents" USING btree ("workspace_id","status","created_at");