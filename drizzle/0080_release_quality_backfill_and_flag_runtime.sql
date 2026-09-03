-- Repair the legacy telemetry migration with an observable, bounded worker.
-- New writes already populate the privacy fields; only rows predating 0076 are eligible.
CREATE TABLE IF NOT EXISTS "product_telemetry_backfill_progress" (
  "job_key" text PRIMARY KEY,
  "status" text NOT NULL,
  "processed_count" bigint NOT NULL DEFAULT 0,
  "remaining_count" bigint,
  "failure_count" integer NOT NULL DEFAULT 0,
  "last_workspace_id" text,
  "last_event_id" text,
  "last_error_code" text,
  "started_at" timestamptz,
  "updated_at" timestamptz NOT NULL,
  "completed_at" timestamptz,
  CONSTRAINT "product_telemetry_backfill_progress_values_check" CHECK (
    "job_key" = 'privacy_fields_v1' AND
    "status" IN ('pending','running','completed','failed') AND
    "processed_count" >= 0 AND
    ("remaining_count" IS NULL OR "remaining_count" >= 0) AND
    "failure_count" >= 0
  )
);

INSERT INTO "product_telemetry_backfill_progress" ("job_key", "status", "updated_at")
VALUES ('privacy_fields_v1', 'pending', statement_timestamp())
ON CONFLICT ("job_key") DO NOTHING;

CREATE OR REPLACE FUNCTION backfill_product_telemetry_privacy_fields(p_limit integer DEFAULT 500)
RETURNS TABLE(processed integer, remaining bigint, status text, last_workspace_id text, last_event_id text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_processed integer := 0;
  v_remaining bigint := 0;
  v_last_workspace_id text;
  v_last_event_id text;
BEGIN
  IF p_limit < 1 OR p_limit > 5000 THEN
    RAISE EXCEPTION 'telemetry backfill limit must be between 1 and 5000';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('product-telemetry-privacy-backfill-v1', 0));
  UPDATE "product_telemetry_backfill_progress"
  SET "status" = 'running',
      "started_at" = COALESCE("started_at", statement_timestamp()),
      "updated_at" = statement_timestamp(),
      "last_error_code" = NULL
  WHERE "job_key" = 'privacy_fields_v1';

  -- The trigger exception is transaction-local and used only by this SECURITY DEFINER function.
  PERFORM set_config('app.product_telemetry_backfill', 'enabled', true);
  WITH batch AS (
    SELECT "workspace_id", "event_id"
    FROM "product_telemetry_events"
    WHERE "subject_pseudonym" IS NULL
      AND "region_classification" IS NULL
      AND "expires_at" IS NULL
    ORDER BY "workspace_id", "event_id"
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  ), updated AS (
    UPDATE "product_telemetry_events" AS event
    SET "subject_pseudonym" = 'sub_' || md5(event."workspace_id" || ':' || event."session_pseudonym") || md5(event."session_pseudonym" || ':' || event."workspace_id"),
        "region_classification" = 'unknown',
        "expires_at" = event."received_at" + interval '90 days'
    FROM batch
    WHERE event."workspace_id" = batch."workspace_id" AND event."event_id" = batch."event_id"
    RETURNING event."workspace_id", event."event_id"
  )
  SELECT count(*)::integer, max("workspace_id"), max("event_id")
  INTO v_processed, v_last_workspace_id, v_last_event_id
  FROM updated;

  SELECT count(*) INTO v_remaining
  FROM "product_telemetry_events"
  WHERE "subject_pseudonym" IS NULL OR "region_classification" IS NULL OR "expires_at" IS NULL;

  UPDATE "product_telemetry_backfill_progress"
  SET "status" = CASE WHEN v_remaining = 0 THEN 'completed' ELSE 'running' END,
      "processed_count" = "processed_count" + v_processed,
      "remaining_count" = v_remaining,
      "last_workspace_id" = COALESCE(v_last_workspace_id, "last_workspace_id"),
      "last_event_id" = COALESCE(v_last_event_id, "last_event_id"),
      "updated_at" = statement_timestamp(),
      "completed_at" = CASE WHEN v_remaining = 0 THEN statement_timestamp() ELSE NULL END
  WHERE "job_key" = 'privacy_fields_v1';

  RETURN QUERY SELECT v_processed, v_remaining,
    CASE WHEN v_remaining = 0 THEN 'completed'::text ELSE 'running'::text END,
    v_last_workspace_id, v_last_event_id;
EXCEPTION WHEN OTHERS THEN
  UPDATE "product_telemetry_backfill_progress"
  SET "status" = 'failed',
      "failure_count" = "failure_count" + 1,
      "last_error_code" = SQLSTATE,
      "updated_at" = statement_timestamp()
  WHERE "job_key" = 'privacy_fields_v1';
  RAISE;
END;
$$;

CREATE OR REPLACE FUNCTION prevent_product_telemetry_update() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('app.product_telemetry_backfill', true) = 'enabled'
     AND OLD."subject_pseudonym" IS NULL
     AND OLD."region_classification" IS NULL
     AND OLD."expires_at" IS NULL
     AND NEW."workspace_id" = OLD."workspace_id"
     AND NEW."event_id" = OLD."event_id"
     AND NEW."workspace_pseudonym" = OLD."workspace_pseudonym"
     AND NEW."session_pseudonym" = OLD."session_pseudonym"
     AND NEW."name" = OLD."name"
     AND NEW."experiment_id" IS NOT DISTINCT FROM OLD."experiment_id"
     AND NEW."assignment_revision" IS NOT DISTINCT FROM OLD."assignment_revision"
     AND NEW."occurred_at" = OLD."occurred_at"
     AND NEW."received_at" = OLD."received_at"
     AND NEW."event" = OLD."event"
  THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'product telemetry is append-only';
END;
$$;

DROP TRIGGER IF EXISTS product_telemetry_events_append_only ON "product_telemetry_events";
CREATE TRIGGER product_telemetry_events_append_only
BEFORE UPDATE ON "product_telemetry_events"
FOR EACH ROW EXECUTE FUNCTION prevent_product_telemetry_update();

-- Durable, authoritative release-flag cohort decisions and runtime evaluations.
CREATE TABLE IF NOT EXISTS "release_flag_assignments" (
  "workspace_id" text NOT NULL REFERENCES "workspaces"("id") ON DELETE RESTRICT,
  "flag_id" text NOT NULL,
  "subject_pseudonym" text NOT NULL,
  "flag_revision" integer NOT NULL,
  "eligible" boolean NOT NULL,
  "enabled" boolean NOT NULL,
  "cohort_bucket" integer NOT NULL,
  "assigned_at" timestamptz NOT NULL,
  "expires_at" timestamptz NOT NULL,
  CONSTRAINT "release_flag_assignments_pk" PRIMARY KEY ("workspace_id", "flag_id", "subject_pseudonym", "flag_revision"),
  CONSTRAINT "release_flag_assignments_values_check" CHECK (
    "flag_id" ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$' AND
    "subject_pseudonym" ~ '^sub_[a-f0-9]{64}$' AND
    "flag_revision" > 0 AND "cohort_bucket" BETWEEN 0 AND 9999 AND
    (NOT "enabled" OR "eligible") AND "expires_at" > "assigned_at"
  )
);
CREATE INDEX IF NOT EXISTS "release_flag_assignments_active_idx"
ON "release_flag_assignments" ("workspace_id", "flag_id", "subject_pseudonym", "expires_at");

CREATE TABLE IF NOT EXISTS "release_flag_evaluations" (
  "workspace_id" text NOT NULL REFERENCES "workspaces"("id") ON DELETE RESTRICT,
  "evaluation_id" text NOT NULL,
  "flag_id" text NOT NULL,
  "subject_pseudonym" text NOT NULL,
  "flag_revision" integer NOT NULL,
  "entry_point" text NOT NULL,
  "role" text NOT NULL,
  "entitlement" text NOT NULL,
  "locale" text NOT NULL,
  "eligible" boolean NOT NULL,
  "enabled" boolean NOT NULL,
  "evaluated_at" timestamptz NOT NULL,
  CONSTRAINT "release_flag_evaluations_pk" PRIMARY KEY ("workspace_id", "evaluation_id"),
  CONSTRAINT "release_flag_evaluations_values_check" CHECK (
    "evaluation_id" ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{7,199}$' AND
    "flag_revision" > 0 AND "entry_point" <> '' AND "role" <> '' AND "entitlement" <> '' AND
    "locale" IN ('ar','en') AND (NOT "enabled" OR "eligible")
  )
);
CREATE INDEX IF NOT EXISTS "release_flag_evaluations_flag_idx"
ON "release_flag_evaluations" ("workspace_id", "flag_id", "subject_pseudonym", "evaluated_at");
