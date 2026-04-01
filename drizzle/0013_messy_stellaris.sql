CREATE TYPE "public"."automation_task_state" AS ENUM('pending', 'claimed', 'succeeded', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."saved_prompt_mode" AS ENUM('photo', 'video', 'copy');--> statement-breakpoint
CREATE TYPE "public"."social_dispatch_run_state" AS ENUM('pending', 'claimed', 'succeeded', 'failed');--> statement-breakpoint
CREATE TYPE "public"."social_token_refresh_lease_state" AS ENUM('active', 'released', 'expired');--> statement-breakpoint
CREATE TYPE "public"."social_webhook_dead_letter_replay_state" AS ENUM('dead_lettered', 'replay_requested', 'replayed', 'failed');--> statement-breakpoint
CREATE TABLE "saved_prompts" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"mode" "saved_prompt_mode" NOT NULL,
	"name" text NOT NULL,
	"prompt_text" text NOT NULL,
	"form_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_public" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "social_automation_rules" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"name" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"trigger_source" text NOT NULL,
	"trigger_filters" jsonb,
	"repeat_interval_seconds" integer,
	"max_runs" integer,
	"total_runs" integer DEFAULT 0 NOT NULL,
	"action_type" text DEFAULT 'create_social_post' NOT NULL,
	"action_config" jsonb,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "social_automation_tasks" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"rule_id" text NOT NULL,
	"task_key" text NOT NULL,
	"run_index" integer DEFAULT 1 NOT NULL,
	"state" "automation_task_state" DEFAULT 'pending' NOT NULL,
	"due_at" timestamp with time zone,
	"claim_token" text,
	"claimed_at" timestamp with time zone,
	"claimed_by" text,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"input" jsonb,
	"result" jsonb,
	"error_message" text,
	"source_post_id" text,
	"source_event_id" text,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "social_dispatch_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"dispatch_key" text NOT NULL,
	"state" "social_dispatch_run_state" DEFAULT 'pending' NOT NULL,
	"kind" text DEFAULT 'post' NOT NULL,
	"post_id" text,
	"event_id" text,
	"account_id" text,
	"provider" "social_platform",
	"claim_token" text,
	"claimed_at" timestamp with time zone,
	"finalized_at" timestamp with time zone,
	"error_message" text,
	"result" jsonb,
	"payload" jsonb,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "social_event_reads" (
	"event_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"user_id" text NOT NULL,
	"read_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "social_event_reads_pk" PRIMARY KEY("event_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "social_notification_preferences" (
	"workspace_id" text NOT NULL,
	"user_id" text NOT NULL,
	"in_app_enabled" boolean DEFAULT true NOT NULL,
	"email_enabled" boolean DEFAULT false NOT NULL,
	"webhook_enabled" boolean DEFAULT false NOT NULL,
	"mute_all" boolean DEFAULT false NOT NULL,
	"preferences" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "social_notification_preferences_pk" PRIMARY KEY("workspace_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "social_token_refresh_leases" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"social_account_id" text NOT NULL,
	"lease_token" text NOT NULL,
	"state" "social_token_refresh_lease_state" DEFAULT 'active' NOT NULL,
	"leased_at" timestamp with time zone NOT NULL,
	"lease_expires_at" timestamp with time zone NOT NULL,
	"released_at" timestamp with time zone,
	"claimed_by" text,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "social_webhook_delivery_dead_letters" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"delivery_id" text NOT NULL,
	"webhook_id" text NOT NULL,
	"event_id" text NOT NULL,
	"dead_letter_reason" text NOT NULL,
	"response_status" integer,
	"response_body" text,
	"replay_state" "social_webhook_dead_letter_replay_state" DEFAULT 'dead_lettered' NOT NULL,
	"dead_lettered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"replay_requested_at" timestamp with time zone,
	"replay_requested_by_user_id" text,
	"replay_metadata" jsonb,
	"replay_delivery_id" text,
	"replayed_at" timestamp with time zone,
	"replay_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "social_webhook_subscriptions" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"webhook_id" text NOT NULL,
	"name" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"filters" jsonb,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "social_posts" ADD COLUMN "root_post_id" text;--> statement-breakpoint
ALTER TABLE "social_posts" ADD COLUMN "kind" text DEFAULT 'post' NOT NULL;--> statement-breakpoint
ALTER TABLE "social_posts" ADD COLUMN "delay_seconds" integer;--> statement-breakpoint
ALTER TABLE "social_posts" ADD COLUMN "position" integer;--> statement-breakpoint
ALTER TABLE "social_posts" ADD COLUMN "source_template_post_id" text;--> statement-breakpoint
ALTER TABLE "social_posts" ADD COLUMN "trigger_source" text;--> statement-breakpoint
ALTER TABLE "saved_prompts" ADD CONSTRAINT "saved_prompts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_automation_rules" ADD CONSTRAINT "social_automation_rules_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_automation_rules" ADD CONSTRAINT "social_automation_rules_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_automation_tasks" ADD CONSTRAINT "social_automation_tasks_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_automation_tasks" ADD CONSTRAINT "social_automation_tasks_rule_id_social_automation_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."social_automation_rules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_automation_tasks" ADD CONSTRAINT "social_automation_tasks_source_post_id_social_posts_id_fk" FOREIGN KEY ("source_post_id") REFERENCES "public"."social_posts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_automation_tasks" ADD CONSTRAINT "social_automation_tasks_source_event_id_social_events_id_fk" FOREIGN KEY ("source_event_id") REFERENCES "public"."social_events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_dispatch_runs" ADD CONSTRAINT "social_dispatch_runs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_dispatch_runs" ADD CONSTRAINT "social_dispatch_runs_post_id_social_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."social_posts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_dispatch_runs" ADD CONSTRAINT "social_dispatch_runs_event_id_social_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."social_events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_dispatch_runs" ADD CONSTRAINT "social_dispatch_runs_account_id_social_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."social_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_event_reads" ADD CONSTRAINT "social_event_reads_event_id_social_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."social_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_event_reads" ADD CONSTRAINT "social_event_reads_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_event_reads" ADD CONSTRAINT "social_event_reads_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_notification_preferences" ADD CONSTRAINT "social_notification_preferences_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_notification_preferences" ADD CONSTRAINT "social_notification_preferences_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_token_refresh_leases" ADD CONSTRAINT "social_token_refresh_leases_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_token_refresh_leases" ADD CONSTRAINT "social_token_refresh_leases_social_account_id_social_accounts_id_fk" FOREIGN KEY ("social_account_id") REFERENCES "public"."social_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_webhook_delivery_dead_letters" ADD CONSTRAINT "social_webhook_delivery_dead_letters_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_webhook_delivery_dead_letters" ADD CONSTRAINT "social_webhook_delivery_dead_letters_delivery_id_social_webhook_deliveries_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."social_webhook_deliveries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_webhook_delivery_dead_letters" ADD CONSTRAINT "social_webhook_delivery_dead_letters_webhook_id_social_webhooks_id_fk" FOREIGN KEY ("webhook_id") REFERENCES "public"."social_webhooks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_webhook_delivery_dead_letters" ADD CONSTRAINT "social_webhook_delivery_dead_letters_event_id_social_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."social_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_webhook_delivery_dead_letters" ADD CONSTRAINT "social_webhook_delivery_dead_letters_replay_requested_by_user_id_user_id_fk" FOREIGN KEY ("replay_requested_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_webhook_delivery_dead_letters" ADD CONSTRAINT "social_webhook_delivery_dead_letters_replay_delivery_id_social_webhook_deliveries_id_fk" FOREIGN KEY ("replay_delivery_id") REFERENCES "public"."social_webhook_deliveries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_webhook_subscriptions" ADD CONSTRAINT "social_webhook_subscriptions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_webhook_subscriptions" ADD CONSTRAINT "social_webhook_subscriptions_webhook_id_social_webhooks_id_fk" FOREIGN KEY ("webhook_id") REFERENCES "public"."social_webhooks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_webhook_subscriptions" ADD CONSTRAINT "social_webhook_subscriptions_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "saved_prompts_workspace_deleted_idx" ON "saved_prompts" USING btree ("workspace_id","deleted_at");--> statement-breakpoint
CREATE INDEX "saved_prompts_public_mode_deleted_idx" ON "saved_prompts" USING btree ("is_public","mode","deleted_at");--> statement-breakpoint
CREATE INDEX "saved_prompts_created_at_idx" ON "saved_prompts" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "social_automation_rules_workspace_idx" ON "social_automation_rules" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "social_automation_rules_enabled_idx" ON "social_automation_rules" USING btree ("enabled");--> statement-breakpoint
CREATE INDEX "social_automation_rules_trigger_source_idx" ON "social_automation_rules" USING btree ("trigger_source");--> statement-breakpoint
CREATE INDEX "social_automation_rules_created_at_idx" ON "social_automation_rules" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "social_automation_tasks_workspace_idx" ON "social_automation_tasks" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "social_automation_tasks_rule_idx" ON "social_automation_tasks" USING btree ("rule_id");--> statement-breakpoint
CREATE UNIQUE INDEX "social_automation_tasks_task_key_unique" ON "social_automation_tasks" USING btree ("task_key");--> statement-breakpoint
CREATE UNIQUE INDEX "social_automation_tasks_rule_run_index_unique" ON "social_automation_tasks" USING btree ("rule_id","run_index");--> statement-breakpoint
CREATE INDEX "social_automation_tasks_state_idx" ON "social_automation_tasks" USING btree ("state");--> statement-breakpoint
CREATE INDEX "social_automation_tasks_due_at_idx" ON "social_automation_tasks" USING btree ("due_at");--> statement-breakpoint
CREATE INDEX "social_automation_tasks_run_index_idx" ON "social_automation_tasks" USING btree ("run_index");--> statement-breakpoint
CREATE INDEX "social_automation_tasks_claimed_at_idx" ON "social_automation_tasks" USING btree ("claimed_at");--> statement-breakpoint
CREATE INDEX "social_automation_tasks_created_at_idx" ON "social_automation_tasks" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "social_dispatch_runs_dispatch_key_unique" ON "social_dispatch_runs" USING btree ("dispatch_key");--> statement-breakpoint
CREATE INDEX "social_dispatch_runs_workspace_idx" ON "social_dispatch_runs" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "social_dispatch_runs_state_idx" ON "social_dispatch_runs" USING btree ("state");--> statement-breakpoint
CREATE INDEX "social_dispatch_runs_created_at_idx" ON "social_dispatch_runs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "social_event_reads_workspace_idx" ON "social_event_reads" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "social_event_reads_user_idx" ON "social_event_reads" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "social_event_reads_read_at_idx" ON "social_event_reads" USING btree ("read_at");--> statement-breakpoint
CREATE INDEX "social_notification_preferences_user_idx" ON "social_notification_preferences" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "social_token_refresh_leases_social_account_unique" ON "social_token_refresh_leases" USING btree ("social_account_id");--> statement-breakpoint
CREATE INDEX "social_token_refresh_leases_workspace_idx" ON "social_token_refresh_leases" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "social_token_refresh_leases_state_idx" ON "social_token_refresh_leases" USING btree ("state");--> statement-breakpoint
CREATE INDEX "social_token_refresh_leases_expires_at_idx" ON "social_token_refresh_leases" USING btree ("lease_expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "social_webhook_delivery_dead_letters_delivery_unique" ON "social_webhook_delivery_dead_letters" USING btree ("delivery_id");--> statement-breakpoint
CREATE INDEX "social_webhook_delivery_dead_letters_workspace_idx" ON "social_webhook_delivery_dead_letters" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "social_webhook_delivery_dead_letters_replay_state_idx" ON "social_webhook_delivery_dead_letters" USING btree ("replay_state");--> statement-breakpoint
CREATE INDEX "social_webhook_delivery_dead_letters_created_at_idx" ON "social_webhook_delivery_dead_letters" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "social_webhook_subscriptions_workspace_idx" ON "social_webhook_subscriptions" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "social_webhook_subscriptions_webhook_idx" ON "social_webhook_subscriptions" USING btree ("webhook_id");--> statement-breakpoint
CREATE INDEX "social_webhook_subscriptions_enabled_idx" ON "social_webhook_subscriptions" USING btree ("enabled");--> statement-breakpoint
CREATE INDEX "social_webhook_subscriptions_created_at_idx" ON "social_webhook_subscriptions" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "social_posts_root_post_idx" ON "social_posts" USING btree ("root_post_id");--> statement-breakpoint
CREATE INDEX "social_posts_source_template_post_idx" ON "social_posts" USING btree ("source_template_post_id");--> statement-breakpoint
CREATE INDEX "social_posts_kind_idx" ON "social_posts" USING btree ("kind");--> statement-breakpoint
CREATE INDEX "social_posts_trigger_source_idx" ON "social_posts" USING btree ("trigger_source");