ALTER TABLE "inspiration_trend_sources" DROP CONSTRAINT "inspiration_trend_sources_values_check";
--> statement-breakpoint
ALTER TABLE "inspiration_trend_sources" ADD CONSTRAINT "inspiration_trend_sources_values_check" CHECK (
  "state" IN ('active','paused')
  AND "source_kind" IN ('official_api','licensed_dataset','public_metadata','embeddable_feed','workspace_owned_analytics')
  AND "adapter_key" ~ '^[a-z][a-z0-9._-]{1,119}$'
  AND "schedule_minutes" BETWEEN 5 AND 10080
  AND jsonb_typeof("preferred_regions")='array'
  AND jsonb_typeof("preferred_arabic_varieties")='array'
  AND jsonb_typeof("preferred_formats")='array'
  AND jsonb_typeof("preferred_tags")='array'
  AND jsonb_typeof("excluded_tags")='array'
);
--> statement-breakpoint
CREATE UNIQUE INDEX "assets_workspace_id_unique" ON "assets" ("workspace_id","id");
--> statement-breakpoint
CREATE UNIQUE INDEX "social_posts_workspace_id_unique" ON "social_posts" ("workspace_id","id");
--> statement-breakpoint
CREATE TABLE "workspace_content_performance_observations" (
  "workspace_id" text NOT NULL,
  "id" text NOT NULL,
  "post_id" text NOT NULL,
  "source_asset_id" text NOT NULL,
  "rights_snapshot_id" text NOT NULL,
  "rights_snapshot_revision" integer NOT NULL,
  "rights_snapshot_digest" text NOT NULL,
  "source_kind" text NOT NULL,
  "source_ref" text NOT NULL,
  "source_digest" text NOT NULL,
  "views" bigint NOT NULL,
  "likes" bigint NOT NULL,
  "comments" bigint DEFAULT 0 NOT NULL,
  "region" text NOT NULL,
  "content_language" text NOT NULL,
  "arabic_variety" text,
  "format" text NOT NULL,
  "tags" jsonb NOT NULL,
  "observed_at" timestamptz NOT NULL,
  "captured_at" timestamptz NOT NULL,
  "created_by_user_id" text NOT NULL,
  "idempotency_key" text NOT NULL,
  "request_digest" text NOT NULL,
  CONSTRAINT "workspace_content_performance_observations_pk" PRIMARY KEY ("workspace_id","id"),
  CONSTRAINT "workspace_content_performance_observations_idempotency_unique" UNIQUE ("workspace_id","idempotency_key"),
  CONSTRAINT "workspace_content_performance_observations_values_check" CHECK (
    "source_kind" = 'workspace_attested'
    AND length("source_ref") BETWEEN 1 AND 500
    AND "source_digest" ~ '^sha256:[a-f0-9]{64}$'
    AND "rights_snapshot_digest" ~ '^sha256:[a-f0-9]{64}$'
    AND "rights_snapshot_revision" > 0
    AND "views" BETWEEN 0 AND 9007199254740991
    AND "likes" BETWEEN 0 AND 9007199254740991
    AND "comments" BETWEEN 0 AND 9007199254740991
    AND "content_language" IN ('ar','en')
    AND ("arabic_variety" IS NULL OR "arabic_variety" IN ('msa','gulf','egyptian','levantine','maghrebi'))
    AND "format" IN ('slideshow','wall_of_text','video_hook_demo','speaking_hook_demo','talking_head_ugc','green_screen_meme','talking_head_green_screen','product_spokesperson','green_screen_mobile_app','claymation','character_swap','custom_upload')
    AND jsonb_typeof("tags") = 'array'
    AND "observed_at" <= "captured_at"
    AND length("idempotency_key") BETWEEN 8 AND 200
    AND "request_digest" ~ '^sha256:[a-f0-9]{64}$'
  )
);
--> statement-breakpoint
CREATE INDEX "workspace_content_performance_observations_cursor_idx" ON "workspace_content_performance_observations" ("workspace_id","observed_at" DESC,"id" DESC);
--> statement-breakpoint
CREATE INDEX "workspace_content_performance_observations_post_cursor_idx" ON "workspace_content_performance_observations" ("workspace_id","post_id","observed_at" DESC,"id" DESC);
--> statement-breakpoint
CREATE INDEX "workspace_content_performance_observations_asset_idx" ON "workspace_content_performance_observations" ("workspace_id","source_asset_id");
--> statement-breakpoint
ALTER TABLE "workspace_content_performance_observations" ADD CONSTRAINT "workspace_content_performance_observations_workspace_fk" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "workspace_content_performance_observations" ADD CONSTRAINT "workspace_content_performance_observations_post_fk" FOREIGN KEY ("workspace_id","post_id") REFERENCES "social_posts"("workspace_id","id") ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE "workspace_content_performance_observations" ADD CONSTRAINT "workspace_content_performance_observations_asset_fk" FOREIGN KEY ("workspace_id","source_asset_id") REFERENCES "assets"("workspace_id","id") ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE "workspace_content_performance_observations" ADD CONSTRAINT "workspace_content_performance_observations_rights_snapshot_fk" FOREIGN KEY ("workspace_id","rights_snapshot_id","rights_snapshot_revision") REFERENCES "inspiration_rights_snapshots"("workspace_id","id","revision") ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE "workspace_content_performance_observations" ADD CONSTRAINT "workspace_content_performance_observations_created_by_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "user"("id") ON DELETE RESTRICT;
--> statement-breakpoint
CREATE FUNCTION "prevent_workspace_content_performance_observation_update"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'workspace content performance observations are immutable';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "workspace_content_performance_observations_immutable"
BEFORE UPDATE ON "workspace_content_performance_observations"
FOR EACH ROW EXECUTE FUNCTION "prevent_workspace_content_performance_observation_update"();
