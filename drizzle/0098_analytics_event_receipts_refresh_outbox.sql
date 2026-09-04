ALTER TABLE "product_analytics_observations" ADD COLUMN "event_id" text;
ALTER TABLE "product_analytics_observations" ADD COLUMN "event_type" text;
ALTER TABLE "product_analytics_observations" ADD COLUMN "occurred_at" timestamptz;
ALTER TABLE "product_analytics_observations" ADD COLUMN "captured_at" timestamptz;
ALTER TABLE "product_analytics_observations" ADD COLUMN "credential_digest" text;
ALTER TABLE "product_analytics_observations" ADD COLUMN "receipt_signature" text;
ALTER TABLE "product_analytics_observations" ADD COLUMN "scope" jsonb;

UPDATE "product_analytics_observations"
SET
  "event_id" = 'legacy:' || "id",
  "event_type" = CASE WHEN "source_kind" = 'website_analytics_source' THEN 'page_view' ELSE 'citation_observed' END,
  "occurred_at" = "window_started_at",
  "captured_at" = "created_at",
  "credential_digest" = "request_digest",
  "receipt_signature" = 'hmac-sha256:' || repeat('0', 64),
  "scope" = jsonb_build_object(
    'region', 'unknown',
    'consentRevision', 'legacy-migration',
    'consentPurpose', 'analytics',
    'retentionUntil', to_char("created_at" + interval '365 days', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'campaignTag', null,
    'contentType', 'other',
    'platform', CASE WHEN "source_kind" = 'website_analytics_source' THEN 'website' ELSE 'other' END,
    'accountRefDigest', null,
    'publishingState', 'not_applicable'
  );

ALTER TABLE "product_analytics_observations" ALTER COLUMN "event_id" SET NOT NULL;
ALTER TABLE "product_analytics_observations" ALTER COLUMN "event_type" SET NOT NULL;
ALTER TABLE "product_analytics_observations" ALTER COLUMN "occurred_at" SET NOT NULL;
ALTER TABLE "product_analytics_observations" ALTER COLUMN "captured_at" SET NOT NULL;
ALTER TABLE "product_analytics_observations" ALTER COLUMN "credential_digest" SET NOT NULL;
ALTER TABLE "product_analytics_observations" ALTER COLUMN "receipt_signature" SET NOT NULL;
ALTER TABLE "product_analytics_observations" ALTER COLUMN "scope" SET NOT NULL;
ALTER TABLE "product_analytics_observations" DROP CONSTRAINT "product_analytics_observations_source_check";
ALTER TABLE "product_analytics_observations" DROP CONSTRAINT "product_analytics_observations_value_check";
ALTER TABLE "product_analytics_observations" DROP CONSTRAINT "product_analytics_observations_digest_check";
ALTER TABLE "product_analytics_observations" DROP CONSTRAINT "product_analytics_observations_window_check";
ALTER TABLE "product_analytics_observations" ADD CONSTRAINT "product_analytics_observations_source_check" CHECK (("source_kind" = 'website_analytics_source' AND "metric" = 'websiteViews' AND "event_type" = 'page_view') OR ("source_kind" = 'geo_analytics_source' AND "metric" = 'geoCitations' AND "event_type" = 'citation_observed'));
ALTER TABLE "product_analytics_observations" ADD CONSTRAINT "product_analytics_observations_value_check" CHECK (("event_id" LIKE 'legacy:%' AND "value" BETWEEN 0 AND 10000000) OR ("event_id" NOT LIKE 'legacy:%' AND "value" = 1));
ALTER TABLE "product_analytics_observations" ADD CONSTRAINT "product_analytics_observations_digest_check" CHECK ("evidence_digest" ~ '^sha256:[a-f0-9]{64}$' AND "credential_digest" ~ '^sha256:[a-f0-9]{64}$' AND "receipt_signature" ~ '^hmac-sha256:[a-f0-9]{64}$' AND "request_digest" ~ '^sha256:[a-f0-9]{64}$' AND length("event_id") BETWEEN 8 AND 200 AND length("idempotency_key") BETWEEN 8 AND 200);
ALTER TABLE "product_analytics_observations" ADD CONSTRAINT "product_analytics_observations_window_check" CHECK ("window_ended_at" > "window_started_at" AND "window_ended_at" <= "window_started_at" + interval '24 hours' AND "occurred_at" >= "window_started_at" AND "occurred_at" < "window_ended_at");
ALTER TABLE "product_analytics_observations" ADD CONSTRAINT "product_analytics_observations_scope_check" CHECK (jsonb_typeof("scope") = 'object' AND "scope"->>'region' IN ('mena','eu','other','unknown') AND "scope"->>'consentPurpose' = 'analytics' AND length("scope"->>'consentRevision') BETWEEN 1 AND 100 AND ("scope"->>'retentionUntil')::timestamptz > "captured_at");
CREATE UNIQUE INDEX "product_analytics_observations_event_unique" ON "product_analytics_observations" ("workspace_id", "source_id", "event_id");

CREATE OR REPLACE FUNCTION reject_product_analytics_observation_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'product_analytics_observations is append-only';
END;
$$;
CREATE TRIGGER product_analytics_observations_append_only
BEFORE UPDATE OR DELETE ON "product_analytics_observations"
FOR EACH ROW EXECUTE FUNCTION reject_product_analytics_observation_mutation();

CREATE TABLE "product_analytics_refresh_jobs" (
  "workspace_id" text NOT NULL REFERENCES "workspaces"("id") ON DELETE RESTRICT,
  "id" text NOT NULL,
  "source_id" text NOT NULL,
  "source_revision" integer NOT NULL,
  "source_kind" text NOT NULL,
  "state" text NOT NULL,
  "cursor" text,
  "processed_events" integer NOT NULL DEFAULT 0,
  "attempt" integer NOT NULL DEFAULT 0,
  "max_attempts" integer NOT NULL DEFAULT 8,
  "lease_owner" text,
  "lease_epoch" integer NOT NULL DEFAULT 0,
  "lease_expires_at" timestamptz,
  "next_attempt_at" timestamptz NOT NULL,
  "last_error_code" text,
  "idempotency_key" text NOT NULL,
  "request_digest" text NOT NULL,
  "requested_by_user_id" text NOT NULL REFERENCES "user"("id") ON DELETE RESTRICT,
  "requested_at" timestamptz NOT NULL,
  "started_at" timestamptz,
  "finished_at" timestamptz,
  "updated_at" timestamptz NOT NULL,
  CONSTRAINT "product_analytics_refresh_jobs_pk" PRIMARY KEY ("workspace_id", "id"),
  CONSTRAINT "product_analytics_refresh_jobs_command_unique" UNIQUE ("workspace_id", "idempotency_key"),
  CONSTRAINT "product_analytics_refresh_jobs_source_revision_fk" FOREIGN KEY ("workspace_id", "source_id", "source_revision") REFERENCES "workspace_product_record_revisions"("workspace_id", "record_id", "revision") ON DELETE RESTRICT,
  CONSTRAINT "product_analytics_refresh_jobs_state_check" CHECK ("state" IN ('queued','claimed','running','succeeded','failed_known','outcome_unknown') AND "source_kind" IN ('website_analytics_source','geo_analytics_source') AND "processed_events" >= 0 AND "attempt" >= 0 AND "attempt" <= "max_attempts" AND "max_attempts" BETWEEN 1 AND 20 AND "lease_epoch" >= 0),
  CONSTRAINT "product_analytics_refresh_jobs_lease_check" CHECK (("state" IN ('claimed','running') AND "lease_owner" IS NOT NULL AND "lease_expires_at" IS NOT NULL) OR ("state" NOT IN ('claimed','running') AND "lease_owner" IS NULL AND "lease_expires_at" IS NULL)),
  CONSTRAINT "product_analytics_refresh_jobs_digest_check" CHECK ("request_digest" ~ '^sha256:[a-f0-9]{64}$' AND length("idempotency_key") BETWEEN 8 AND 200)
);
CREATE INDEX "product_analytics_refresh_jobs_due_idx" ON "product_analytics_refresh_jobs" ("state", "next_attempt_at", "lease_expires_at", "id");
CREATE INDEX "product_analytics_refresh_jobs_source_idx" ON "product_analytics_refresh_jobs" ("workspace_id", "source_id", "requested_at", "id");
