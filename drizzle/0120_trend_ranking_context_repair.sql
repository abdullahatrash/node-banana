ALTER TABLE "inspiration_trend_ingestion_jobs" ADD COLUMN IF NOT EXISTS "ranking_context" jsonb;
--> statement-breakpoint
UPDATE "inspiration_trend_ingestion_jobs"
SET
  "state" = 'failed_known',
  "lease_owner" = NULL,
  "lease_expires_at" = NULL,
  "failure_code" = 'TREND_RANKING_CONTEXT_MIGRATED_UNPINNED',
  "finished_at" = COALESCE("finished_at", now()),
  "updated_at" = now()
WHERE "ranking_context" IS NULL
  AND "state" IN ('queued','claimed');
--> statement-breakpoint
UPDATE "inspiration_trend_ingestion_jobs" AS jobs
SET "ranking_context" = jsonb_build_object(
  'brandProfile', NULL,
  'preferredRegions', sources."preferred_regions",
  'preferredArabicVarieties', sources."preferred_arabic_varieties",
  'preferredFormats', sources."preferred_formats",
  'preferredTags', sources."preferred_tags",
  'excludedTags', sources."excluded_tags"
)
FROM "inspiration_trend_sources" AS sources
WHERE jobs."ranking_context" IS NULL
  AND sources."workspace_id" = jobs."workspace_id"
  AND sources."id" = jobs."source_id";
--> statement-breakpoint
ALTER TABLE "inspiration_trend_ingestion_jobs" ALTER COLUMN "ranking_context" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "inspiration_trend_ingestion_jobs" DROP CONSTRAINT "inspiration_trend_ingestion_jobs_values_check";
--> statement-breakpoint
ALTER TABLE "inspiration_trend_ingestion_jobs" ADD CONSTRAINT "inspiration_trend_ingestion_jobs_values_check" CHECK (
  "state" IN ('queued','claimed','succeeded','failed_known')
  AND "lease_epoch">=0 AND "attempt">=0 AND "attempt"<="max_attempts" AND "max_attempts" BETWEEN 1 AND 20
  AND "page_count">=0 AND "inserted_count">=0 AND "updated_count">=0 AND "replayed_count">=0 AND "restricted_count">=0
  AND jsonb_typeof("ranking_context")='object'
);
