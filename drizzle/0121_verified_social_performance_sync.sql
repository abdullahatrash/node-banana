CREATE UNIQUE INDEX "social_accounts_workspace_id_unique" ON "social_accounts" ("workspace_id","id");
--> statement-breakpoint
ALTER TABLE "workspace_content_performance_observations" DROP CONSTRAINT "workspace_content_performance_observations_values_check";
--> statement-breakpoint
ALTER TABLE "workspace_content_performance_observations" ALTER COLUMN "views" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "workspace_content_performance_observations" ALTER COLUMN "likes" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "workspace_content_performance_observations" ALTER COLUMN "comments" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "workspace_content_performance_observations" ALTER COLUMN "comments" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "workspace_content_performance_observations" ADD COLUMN "platform" "social_platform";
--> statement-breakpoint
ALTER TABLE "workspace_content_performance_observations" ADD COLUMN "provider_account_id" text;
--> statement-breakpoint
ALTER TABLE "workspace_content_performance_observations" ADD COLUMN "provider_post_id" text;
--> statement-breakpoint
ALTER TABLE "workspace_content_performance_observations" ADD COLUMN "provider_request_id" text;
--> statement-breakpoint
ALTER TABLE "workspace_content_performance_observations" ADD COLUMN "reported_metrics" jsonb DEFAULT '[]'::jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "workspace_content_performance_observations" ADD COLUMN "provider_receipt" jsonb DEFAULT '{}'::jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "workspace_content_performance_observations" ADD CONSTRAINT "workspace_content_performance_observations_values_check" CHECK (
  "source_kind" IN ('workspace_attested','platform_verified')
  AND length("source_ref") BETWEEN 1 AND 500
  AND "source_digest" ~ '^sha256:[a-f0-9]{64}$'
  AND "rights_snapshot_digest" ~ '^sha256:[a-f0-9]{64}$'
  AND "rights_snapshot_revision" > 0
  AND ("views" IS NULL OR "views" BETWEEN 0 AND 9007199254740991)
  AND ("likes" IS NULL OR "likes" BETWEEN 0 AND 9007199254740991)
  AND ("comments" IS NULL OR "comments" BETWEEN 0 AND 9007199254740991)
  AND ("views" IS NOT NULL OR "likes" IS NOT NULL OR "comments" IS NOT NULL)
  AND "content_language" IN ('ar','en')
  AND ("arabic_variety" IS NULL OR "arabic_variety" IN ('msa','gulf','egyptian','levantine','maghrebi'))
  AND "format" IN ('slideshow','wall_of_text','video_hook_demo','speaking_hook_demo','talking_head_ugc','green_screen_meme','talking_head_green_screen','product_spokesperson','green_screen_mobile_app','claymation','character_swap','custom_upload')
  AND jsonb_typeof("tags") = 'array'
  AND jsonb_typeof("reported_metrics") = 'array'
  AND "reported_metrics" <@ '["views","likes","comments","shares"]'::jsonb
  AND jsonb_typeof("provider_receipt") = 'object'
  AND "observed_at" <= "captured_at"
  AND length("idempotency_key") BETWEEN 8 AND 200
  AND "request_digest" ~ '^sha256:[a-f0-9]{64}$'
  AND (
    ("source_kind" = 'workspace_attested' AND "platform" IS NULL AND "provider_account_id" IS NULL AND "provider_post_id" IS NULL AND "provider_request_id" IS NULL)
    OR
    ("source_kind" = 'platform_verified' AND "platform" IN ('instagram','tiktok','youtube') AND length("provider_account_id") BETWEEN 1 AND 200 AND length("provider_post_id") BETWEEN 1 AND 200 AND ("provider_request_id" IS NULL OR length("provider_request_id") BETWEEN 1 AND 200) AND "source_ref" ~ '^https://' AND jsonb_array_length("reported_metrics") > 0)
  )
);
--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_content_performance_observations_verified_digest_unique" ON "workspace_content_performance_observations" ("workspace_id","source_digest") WHERE "source_kind" = 'platform_verified';
--> statement-breakpoint
CREATE TABLE "workspace_content_performance_syncs" (
  "workspace_id" text NOT NULL,
  "id" text NOT NULL,
  "post_id" text NOT NULL,
  "source_asset_id" text NOT NULL,
  "social_account_id" text NOT NULL,
  "rights_snapshot_id" text NOT NULL,
  "rights_snapshot_revision" integer NOT NULL,
  "rights_snapshot_digest" text NOT NULL,
  "region" text NOT NULL,
  "content_language" text NOT NULL,
  "arabic_variety" text,
  "format" text NOT NULL,
  "tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "state" text DEFAULT 'active' NOT NULL,
  "schedule_minutes" integer DEFAULT 60 NOT NULL,
  "next_run_at" timestamptz NOT NULL,
  "last_observed_at" timestamptz,
  "last_source_digest" text,
  "last_error_code" text,
  "created_by_user_id" text NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "workspace_content_performance_syncs_pk" PRIMARY KEY ("workspace_id","id"),
  CONSTRAINT "workspace_content_performance_syncs_post_unique" UNIQUE ("workspace_id","post_id","source_asset_id"),
  CONSTRAINT "workspace_content_performance_syncs_values_check" CHECK (
    "state" IN ('active','paused','needs_reauth') AND "schedule_minutes" BETWEEN 15 AND 10080
    AND "rights_snapshot_revision" > 0 AND "rights_snapshot_digest" ~ '^sha256:[a-f0-9]{64}$'
    AND "content_language" IN ('ar','en') AND ("arabic_variety" IS NULL OR "arabic_variety" IN ('msa','gulf','egyptian','levantine','maghrebi'))
    AND "format" IN ('slideshow','wall_of_text','video_hook_demo','speaking_hook_demo','talking_head_ugc','green_screen_meme','talking_head_green_screen','product_spokesperson','green_screen_mobile_app','claymation','character_swap','custom_upload')
    AND jsonb_typeof("tags") = 'array'
  )
);
--> statement-breakpoint
CREATE INDEX "workspace_content_performance_syncs_due_idx" ON "workspace_content_performance_syncs" ("next_run_at","workspace_id","id") WHERE "state" = 'active';
--> statement-breakpoint
ALTER TABLE "workspace_content_performance_syncs" ADD CONSTRAINT "workspace_content_performance_syncs_workspace_fk" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "workspace_content_performance_syncs" ADD CONSTRAINT "workspace_content_performance_syncs_post_fk" FOREIGN KEY ("workspace_id","post_id") REFERENCES "social_posts"("workspace_id","id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "workspace_content_performance_syncs" ADD CONSTRAINT "workspace_content_performance_syncs_asset_fk" FOREIGN KEY ("workspace_id","source_asset_id") REFERENCES "assets"("workspace_id","id") ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE "workspace_content_performance_syncs" ADD CONSTRAINT "workspace_content_performance_syncs_account_fk" FOREIGN KEY ("workspace_id","social_account_id") REFERENCES "social_accounts"("workspace_id","id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "workspace_content_performance_syncs" ADD CONSTRAINT "workspace_content_performance_syncs_rights_snapshot_fk" FOREIGN KEY ("workspace_id","rights_snapshot_id","rights_snapshot_revision") REFERENCES "inspiration_rights_snapshots"("workspace_id","id","revision") ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE "workspace_content_performance_syncs" ADD CONSTRAINT "workspace_content_performance_syncs_created_by_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "user"("id") ON DELETE RESTRICT;
--> statement-breakpoint
CREATE TABLE "workspace_content_performance_sync_jobs" (
  "workspace_id" text NOT NULL,
  "id" text NOT NULL,
  "sync_id" text NOT NULL,
  "source_key" text NOT NULL,
  "state" text DEFAULT 'queued' NOT NULL,
  "attempt" integer DEFAULT 0 NOT NULL,
  "max_attempts" integer DEFAULT 4 NOT NULL,
  "next_attempt_at" timestamptz NOT NULL,
  "lease_owner" text,
  "lease_expires_at" timestamptz,
  "lease_generation" integer DEFAULT 0 NOT NULL,
  "failure_code" text,
  "observation_id" text,
  "requested_at" timestamptz NOT NULL,
  "finished_at" timestamptz,
  "updated_at" timestamptz NOT NULL,
  CONSTRAINT "workspace_content_performance_sync_jobs_pk" PRIMARY KEY ("workspace_id","id"),
  CONSTRAINT "workspace_content_performance_sync_jobs_source_unique" UNIQUE ("workspace_id","sync_id","source_key"),
  CONSTRAINT "workspace_content_performance_sync_jobs_values_check" CHECK (
    "state" IN ('queued','claimed','succeeded','failed_known') AND "attempt" BETWEEN 0 AND "max_attempts" AND "max_attempts" BETWEEN 1 AND 10
    AND "lease_generation" >= 0 AND length("source_key") BETWEEN 1 AND 200
    AND (("state" = 'claimed' AND "lease_owner" IS NOT NULL AND "lease_expires_at" IS NOT NULL) OR ("state" <> 'claimed' AND "lease_owner" IS NULL AND "lease_expires_at" IS NULL))
  )
);
--> statement-breakpoint
CREATE INDEX "workspace_content_performance_sync_jobs_due_idx" ON "workspace_content_performance_sync_jobs" ("next_attempt_at","workspace_id","id") WHERE "state" = 'queued';
--> statement-breakpoint
ALTER TABLE "workspace_content_performance_sync_jobs" ADD CONSTRAINT "workspace_content_performance_sync_jobs_workspace_fk" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "workspace_content_performance_sync_jobs" ADD CONSTRAINT "workspace_content_performance_sync_jobs_sync_fk" FOREIGN KEY ("workspace_id","sync_id") REFERENCES "workspace_content_performance_syncs"("workspace_id","id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "workspace_content_performance_sync_jobs" ADD CONSTRAINT "workspace_content_performance_sync_jobs_observation_fk" FOREIGN KEY ("workspace_id","observation_id") REFERENCES "workspace_content_performance_observations"("workspace_id","id") ON DELETE RESTRICT;
