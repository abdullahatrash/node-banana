CREATE TYPE "public"."social_dispatch_status" AS ENUM('pending', 'dispatched', 'retry_scheduled', 'failed');--> statement-breakpoint
ALTER TABLE "social_posts" ADD COLUMN "dispatch_status" "social_dispatch_status";--> statement-breakpoint
ALTER TABLE "social_posts" ADD COLUMN "dispatch_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "social_posts" ADD COLUMN "workflow_run_ref" text;--> statement-breakpoint
ALTER TABLE "social_posts" ADD COLUMN "next_dispatch_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "social_posts" ADD COLUMN "last_dispatch_error" text;--> statement-breakpoint
ALTER TABLE "social_posts" ADD COLUMN "locked_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "social_posts_dispatch_status_idx" ON "social_posts" USING btree ("dispatch_status");--> statement-breakpoint
CREATE INDEX "social_posts_next_dispatch_at_idx" ON "social_posts" USING btree ("next_dispatch_at");