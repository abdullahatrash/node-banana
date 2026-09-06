CREATE TABLE "inspiration_trend_sources" (
  "workspace_id" text NOT NULL,
  "id" text NOT NULL,
  "adapter_key" text NOT NULL,
  "source_kind" text NOT NULL,
  "display_name" text NOT NULL,
  "state" text NOT NULL,
  "schedule_minutes" integer NOT NULL,
  "next_run_at" timestamptz NOT NULL,
  "cursor" text,
  "preferred_regions" jsonb NOT NULL,
  "preferred_arabic_varieties" jsonb NOT NULL,
  "preferred_formats" jsonb NOT NULL,
  "preferred_tags" jsonb NOT NULL,
  "excluded_tags" jsonb NOT NULL,
  "created_by_user_id" text NOT NULL,
  "created_at" timestamptz NOT NULL,
  "updated_at" timestamptz NOT NULL,
  CONSTRAINT "inspiration_trend_sources_pk" PRIMARY KEY ("workspace_id","id"),
  CONSTRAINT "inspiration_trend_sources_values_check" CHECK (
    "state" IN ('active','paused')
    AND "source_kind" IN ('official_api','licensed_dataset','public_metadata','embeddable_feed')
    AND "adapter_key" ~ '^[a-z][a-z0-9._-]{1,119}$'
    AND "schedule_minutes" BETWEEN 5 AND 10080
    AND jsonb_typeof("preferred_regions")='array'
    AND jsonb_typeof("preferred_arabic_varieties")='array'
    AND jsonb_typeof("preferred_formats")='array'
    AND jsonb_typeof("preferred_tags")='array'
    AND jsonb_typeof("excluded_tags")='array'
  )
);
--> statement-breakpoint
CREATE INDEX "inspiration_trend_sources_due_idx" ON "inspiration_trend_sources" ("state","next_run_at","workspace_id","id");
--> statement-breakpoint
ALTER TABLE "inspiration_trend_sources" ADD CONSTRAINT "inspiration_trend_sources_workspace_fk" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE "inspiration_trend_sources" ADD CONSTRAINT "inspiration_trend_sources_created_by_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "user"("id") ON DELETE RESTRICT;
--> statement-breakpoint
CREATE TABLE "inspiration_trend_ingestion_jobs" (
  "workspace_id" text NOT NULL,
  "id" text NOT NULL,
  "source_id" text NOT NULL,
  "source_key" text NOT NULL,
  "requested_by_user_id" text NOT NULL,
  "state" text NOT NULL,
  "cursor" text,
  "ranking_context" jsonb NOT NULL,
  "lease_owner" text,
  "lease_expires_at" timestamptz,
  "lease_epoch" integer DEFAULT 0 NOT NULL,
  "attempt" integer DEFAULT 0 NOT NULL,
  "max_attempts" integer DEFAULT 5 NOT NULL,
  "page_count" integer DEFAULT 0 NOT NULL,
  "inserted_count" integer DEFAULT 0 NOT NULL,
  "updated_count" integer DEFAULT 0 NOT NULL,
  "replayed_count" integer DEFAULT 0 NOT NULL,
  "restricted_count" integer DEFAULT 0 NOT NULL,
  "next_attempt_at" timestamptz NOT NULL,
  "failure_code" text,
  "requested_at" timestamptz NOT NULL,
  "started_at" timestamptz,
  "finished_at" timestamptz,
  "updated_at" timestamptz NOT NULL,
  CONSTRAINT "inspiration_trend_ingestion_jobs_pk" PRIMARY KEY ("workspace_id","id"),
  CONSTRAINT "inspiration_trend_ingestion_jobs_source_key_unique" UNIQUE ("workspace_id","source_id","source_key"),
  CONSTRAINT "inspiration_trend_ingestion_jobs_values_check" CHECK (
    "state" IN ('queued','claimed','succeeded','failed_known')
    AND "lease_epoch">=0 AND "attempt">=0 AND "attempt"<="max_attempts" AND "max_attempts" BETWEEN 1 AND 20
    AND "page_count">=0 AND "inserted_count">=0 AND "updated_count">=0 AND "replayed_count">=0 AND "restricted_count">=0
    AND jsonb_typeof("ranking_context")='object'
  ),
  CONSTRAINT "inspiration_trend_ingestion_jobs_lease_check" CHECK (
    ("state"='claimed' AND "lease_owner" IS NOT NULL AND "lease_expires_at" IS NOT NULL)
    OR ("state"<>'claimed' AND "lease_owner" IS NULL AND "lease_expires_at" IS NULL)
  )
);
--> statement-breakpoint
CREATE INDEX "inspiration_trend_ingestion_jobs_due_idx" ON "inspiration_trend_ingestion_jobs" ("state","next_attempt_at","lease_expires_at","id");
--> statement-breakpoint
ALTER TABLE "inspiration_trend_ingestion_jobs" ADD CONSTRAINT "inspiration_trend_ingestion_jobs_source_fk" FOREIGN KEY ("workspace_id","source_id") REFERENCES "inspiration_trend_sources"("workspace_id","id") ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE "inspiration_trend_ingestion_jobs" ADD CONSTRAINT "inspiration_trend_ingestion_jobs_requested_by_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "user"("id") ON DELETE RESTRICT;
--> statement-breakpoint
CREATE TABLE "inspiration_trend_feed_entries" (
  "workspace_id" text NOT NULL,
  "inspiration_item_id" text NOT NULL,
  "source_id" text NOT NULL,
  "external_item_id" text NOT NULL,
  "score" integer NOT NULL,
  "ranking_digest" text NOT NULL,
  "metrics_observed_at" timestamptz NOT NULL,
  "source_published_at" timestamptz NOT NULL,
  "rights_expires_at" timestamptz,
  "region" text NOT NULL,
  "content_language" text NOT NULL,
  "arabic_variety" text,
  "format" text NOT NULL,
  "rights_status" text NOT NULL,
  "eligible_for_blitz" boolean NOT NULL,
  "searchable_text" text NOT NULL,
  "updated_at" timestamptz NOT NULL,
  CONSTRAINT "inspiration_trend_feed_entries_pk" PRIMARY KEY ("workspace_id","inspiration_item_id"),
  CONSTRAINT "inspiration_trend_feed_entries_source_item_unique" UNIQUE ("workspace_id","source_id","external_item_id"),
  CONSTRAINT "inspiration_trend_feed_entries_values_check" CHECK (
    "score" BETWEEN 0 AND 10000
    AND "ranking_digest" ~ '^sha256:[a-f0-9]{64}$'
    AND "content_language" IN ('ar','en')
    AND "rights_status" IN ('licensed','user_submitted','embeddable','metadata_only','restricted')
  )
);
--> statement-breakpoint
CREATE INDEX "inspiration_trend_feed_entries_rank_idx" ON "inspiration_trend_feed_entries" ("workspace_id","score" DESC,"metrics_observed_at" DESC,"inspiration_item_id");
--> statement-breakpoint
CREATE INDEX "inspiration_trend_feed_entries_filter_idx" ON "inspiration_trend_feed_entries" ("workspace_id","content_language","region","format","rights_status");
--> statement-breakpoint
ALTER TABLE "inspiration_trend_feed_entries" ADD CONSTRAINT "inspiration_trend_feed_entries_item_fk" FOREIGN KEY ("workspace_id","inspiration_item_id") REFERENCES "workspace_product_records"("workspace_id","id") ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE "inspiration_trend_feed_entries" ADD CONSTRAINT "inspiration_trend_feed_entries_source_fk" FOREIGN KEY ("workspace_id","source_id") REFERENCES "inspiration_trend_sources"("workspace_id","id") ON DELETE RESTRICT;
--> statement-breakpoint
CREATE TABLE "inspiration_trend_ingestion_receipts" (
  "workspace_id" text NOT NULL,
  "source_id" text NOT NULL,
  "external_item_id" text NOT NULL,
  "observation_digest" text NOT NULL,
  "inspiration_item_id" text NOT NULL,
  "inspiration_item_revision" integer NOT NULL,
  "source_content_digest" text NOT NULL,
  "rights_evidence_digest" text NOT NULL,
  "ranking_digest" text NOT NULL,
  "created_at" timestamptz NOT NULL,
  CONSTRAINT "inspiration_trend_ingestion_receipts_pk" PRIMARY KEY ("workspace_id","source_id","external_item_id","observation_digest","ranking_digest"),
  CONSTRAINT "inspiration_trend_ingestion_receipts_digests_check" CHECK (
    "observation_digest" ~ '^sha256:[a-f0-9]{64}$'
    AND "source_content_digest" ~ '^sha256:[a-f0-9]{64}$'
    AND "rights_evidence_digest" ~ '^sha256:[a-f0-9]{64}$'
    AND "ranking_digest" ~ '^sha256:[a-f0-9]{64}$'
    AND "inspiration_item_revision">0
  )
);
--> statement-breakpoint
CREATE INDEX "inspiration_trend_ingestion_receipts_item_idx" ON "inspiration_trend_ingestion_receipts" ("workspace_id","inspiration_item_id","created_at");
--> statement-breakpoint
ALTER TABLE "inspiration_trend_ingestion_receipts" ADD CONSTRAINT "inspiration_trend_ingestion_receipts_source_fk" FOREIGN KEY ("workspace_id","source_id") REFERENCES "inspiration_trend_sources"("workspace_id","id") ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE "inspiration_trend_ingestion_receipts" ADD CONSTRAINT "inspiration_trend_ingestion_receipts_revision_fk" FOREIGN KEY ("workspace_id","inspiration_item_id","inspiration_item_revision") REFERENCES "workspace_product_record_revisions"("workspace_id","record_id","revision") ON DELETE RESTRICT;
--> statement-breakpoint
CREATE TRIGGER "inspiration_trend_ingestion_receipts_append_only" BEFORE UPDATE OR DELETE ON "inspiration_trend_ingestion_receipts" FOR EACH ROW EXECUTE FUNCTION "reject_workspace_product_history_mutation"();
