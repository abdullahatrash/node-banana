CREATE TYPE "public"."social_event_severity" AS ENUM('info', 'warn', 'error');--> statement-breakpoint
CREATE TYPE "public"."social_event_type" AS ENUM('post.queued', 'post.publishing', 'post.published', 'post.failed', 'account.reauth_required', 'token.refreshed', 'dispatch.failed');--> statement-breakpoint
CREATE TYPE "public"."social_webhook_delivery_status" AS ENUM('pending', 'success', 'failed');--> statement-breakpoint
CREATE TABLE "social_events" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"event_type" "social_event_type" NOT NULL,
	"severity" "social_event_severity" DEFAULT 'info' NOT NULL,
	"message" text NOT NULL,
	"user_facing" boolean DEFAULT false NOT NULL,
	"read_at" timestamp with time zone,
	"post_id" text,
	"account_id" text,
	"provider" "social_platform",
	"dispatch_key" text,
	"workflow_run_ref" text,
	"metadata" jsonb,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "social_webhook_deliveries" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"webhook_id" text NOT NULL,
	"event_id" text NOT NULL,
	"status" "social_webhook_delivery_status" DEFAULT 'pending' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone,
	"last_attempt_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"response_status" integer,
	"response_body" text,
	"last_error" text,
	"locked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "social_webhooks" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"target_url" text NOT NULL,
	"signing_secret_encrypted" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "social_events" ADD CONSTRAINT "social_events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_events" ADD CONSTRAINT "social_events_post_id_social_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."social_posts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_events" ADD CONSTRAINT "social_events_account_id_social_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."social_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_events" ADD CONSTRAINT "social_events_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_webhook_deliveries" ADD CONSTRAINT "social_webhook_deliveries_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_webhook_deliveries" ADD CONSTRAINT "social_webhook_deliveries_webhook_id_social_webhooks_id_fk" FOREIGN KEY ("webhook_id") REFERENCES "public"."social_webhooks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_webhook_deliveries" ADD CONSTRAINT "social_webhook_deliveries_event_id_social_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."social_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_webhooks" ADD CONSTRAINT "social_webhooks_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_webhooks" ADD CONSTRAINT "social_webhooks_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "social_events_workspace_idx" ON "social_events" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "social_events_event_type_idx" ON "social_events" USING btree ("event_type");--> statement-breakpoint
CREATE INDEX "social_events_user_facing_idx" ON "social_events" USING btree ("user_facing");--> statement-breakpoint
CREATE INDEX "social_events_read_at_idx" ON "social_events" USING btree ("read_at");--> statement-breakpoint
CREATE INDEX "social_events_post_idx" ON "social_events" USING btree ("post_id");--> statement-breakpoint
CREATE INDEX "social_events_account_idx" ON "social_events" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "social_events_created_at_idx" ON "social_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "social_webhook_deliveries_workspace_idx" ON "social_webhook_deliveries" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "social_webhook_deliveries_webhook_idx" ON "social_webhook_deliveries" USING btree ("webhook_id");--> statement-breakpoint
CREATE INDEX "social_webhook_deliveries_event_idx" ON "social_webhook_deliveries" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "social_webhook_deliveries_status_idx" ON "social_webhook_deliveries" USING btree ("status");--> statement-breakpoint
CREATE INDEX "social_webhook_deliveries_next_attempt_at_idx" ON "social_webhook_deliveries" USING btree ("next_attempt_at");--> statement-breakpoint
CREATE INDEX "social_webhook_deliveries_locked_at_idx" ON "social_webhook_deliveries" USING btree ("locked_at");--> statement-breakpoint
CREATE INDEX "social_webhook_deliveries_created_at_idx" ON "social_webhook_deliveries" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "social_webhooks_workspace_idx" ON "social_webhooks" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "social_webhooks_enabled_idx" ON "social_webhooks" USING btree ("enabled");--> statement-breakpoint
CREATE INDEX "social_webhooks_created_at_idx" ON "social_webhooks" USING btree ("created_at");