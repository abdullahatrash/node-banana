CREATE TABLE "youtube_trend_discovery_sources" (
  "workspace_id" text NOT NULL,
  "id" text NOT NULL,
  "region_code" text NOT NULL,
  "category_id" text DEFAULT '0' NOT NULL,
  "display_name" text NOT NULL,
  "state" text DEFAULT 'active' NOT NULL,
  "schedule_minutes" integer DEFAULT 360 NOT NULL,
  "page_size" integer DEFAULT 25 NOT NULL,
  "next_run_at" timestamptz NOT NULL,
  "last_refreshed_at" timestamptz,
  "last_error_code" text,
  "created_by_user_id" text NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "youtube_trend_discovery_sources_pk" PRIMARY KEY ("workspace_id", "id"),
  CONSTRAINT "youtube_trend_discovery_sources_chart_unique" UNIQUE ("workspace_id", "region_code", "category_id"),
  CONSTRAINT "youtube_trend_discovery_sources_values_check" CHECK ("region_code" ~ '^[A-Z]{2}$' AND "category_id" ~ '^(0|[1-9][0-9]*)$' AND "state" IN ('active','paused') AND "schedule_minutes" BETWEEN 60 AND 10080 AND "page_size" BETWEEN 1 AND 50 AND length("display_name") BETWEEN 1 AND 200)
);
--> statement-breakpoint
CREATE INDEX "youtube_trend_discovery_sources_due_idx" ON "youtube_trend_discovery_sources" ("next_run_at", "workspace_id", "id") WHERE "state" = 'active';
--> statement-breakpoint
ALTER TABLE "youtube_trend_discovery_sources" ADD CONSTRAINT "youtube_trend_discovery_sources_workspace_fk" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "youtube_trend_discovery_sources" ADD CONSTRAINT "youtube_trend_discovery_sources_created_by_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "user"("id") ON DELETE RESTRICT;
--> statement-breakpoint
CREATE TABLE "youtube_trend_discovery_entries" (
  "workspace_id" text NOT NULL,
  "source_id" text NOT NULL,
  "video_id" text NOT NULL,
  "provider_rank" integer NOT NULL,
  "title" text NOT NULL,
  "channel_id" text NOT NULL,
  "channel_title" text NOT NULL,
  "source_url" text NOT NULL,
  "thumbnail_url" text,
  "published_at" timestamptz NOT NULL,
  "view_count" text,
  "like_count" text,
  "comment_count" text,
  "observed_at" timestamptz NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "updated_at" timestamptz NOT NULL,
  CONSTRAINT "youtube_trend_discovery_entries_pk" PRIMARY KEY ("workspace_id", "source_id", "video_id"),
  CONSTRAINT "youtube_trend_discovery_entries_values_check" CHECK ("provider_rank" BETWEEN 1 AND 50 AND length("video_id") BETWEEN 1 AND 32 AND length("title") BETWEEN 1 AND 240 AND length("channel_id") BETWEEN 1 AND 200 AND length("channel_title") BETWEEN 1 AND 200 AND "source_url" = 'https://www.youtube.com/watch?v=' || "video_id" AND ("thumbnail_url" IS NULL OR "thumbnail_url" ~ '^https://') AND ("view_count" IS NULL OR "view_count" ~ '^(0|[1-9][0-9]*)$') AND ("like_count" IS NULL OR "like_count" ~ '^(0|[1-9][0-9]*)$') AND ("comment_count" IS NULL OR "comment_count" ~ '^(0|[1-9][0-9]*)$') AND "published_at" <= "observed_at" AND "expires_at" > "observed_at" AND "expires_at" <= "observed_at" + interval '30 days')
);
--> statement-breakpoint
CREATE INDEX "youtube_trend_discovery_entries_order_idx" ON "youtube_trend_discovery_entries" ("workspace_id", "source_id", "provider_rank", "video_id");
--> statement-breakpoint
CREATE INDEX "youtube_trend_discovery_entries_expiry_idx" ON "youtube_trend_discovery_entries" ("expires_at", "workspace_id", "source_id");
--> statement-breakpoint
ALTER TABLE "youtube_trend_discovery_entries" ADD CONSTRAINT "youtube_trend_discovery_entries_source_fk" FOREIGN KEY ("workspace_id", "source_id") REFERENCES "youtube_trend_discovery_sources"("workspace_id", "id") ON DELETE CASCADE;
--> statement-breakpoint
CREATE TABLE "youtube_trend_discovery_jobs" (
  "workspace_id" text NOT NULL,
  "id" text NOT NULL,
  "source_id" text NOT NULL,
  "source_key" text NOT NULL,
  "state" text DEFAULT 'queued' NOT NULL,
  "attempt" integer DEFAULT 0 NOT NULL,
  "max_attempts" integer DEFAULT 4 NOT NULL,
  "next_attempt_at" timestamptz NOT NULL,
  "lease_owner" text,
  "lease_expires_at" timestamptz,
  "lease_generation" integer DEFAULT 0 NOT NULL,
  "failure_code" text,
  "requested_at" timestamptz NOT NULL,
  "finished_at" timestamptz,
  "updated_at" timestamptz NOT NULL,
  CONSTRAINT "youtube_trend_discovery_jobs_pk" PRIMARY KEY ("workspace_id", "id"),
  CONSTRAINT "youtube_trend_discovery_jobs_source_key_unique" UNIQUE ("workspace_id", "source_id", "source_key"),
  CONSTRAINT "youtube_trend_discovery_jobs_values_check" CHECK ("state" IN ('queued','claimed','succeeded','failed_known') AND "attempt" BETWEEN 0 AND "max_attempts" AND "max_attempts" BETWEEN 1 AND 10 AND "lease_generation" >= 0 AND length("source_key") BETWEEN 1 AND 200 AND (("state" = 'claimed' AND "lease_owner" IS NOT NULL AND "lease_expires_at" IS NOT NULL) OR ("state" <> 'claimed' AND "lease_owner" IS NULL AND "lease_expires_at" IS NULL)))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "youtube_trend_discovery_jobs_active_source_unique" ON "youtube_trend_discovery_jobs" ("workspace_id", "source_id") WHERE "state" IN ('queued','claimed');
--> statement-breakpoint
CREATE INDEX "youtube_trend_discovery_jobs_due_idx" ON "youtube_trend_discovery_jobs" ("next_attempt_at", "workspace_id", "id") WHERE "state" = 'queued';
--> statement-breakpoint
ALTER TABLE "youtube_trend_discovery_jobs" ADD CONSTRAINT "youtube_trend_discovery_jobs_source_fk" FOREIGN KEY ("workspace_id", "source_id") REFERENCES "youtube_trend_discovery_sources"("workspace_id", "id") ON DELETE CASCADE;
