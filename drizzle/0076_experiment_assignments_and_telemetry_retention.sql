ALTER TABLE "product_telemetry_events" ADD COLUMN IF NOT EXISTS "subject_pseudonym" text;
ALTER TABLE "product_telemetry_events" ADD COLUMN IF NOT EXISTS "region_classification" text;
ALTER TABLE "product_telemetry_events" ADD COLUMN IF NOT EXISTS "experiment_id" text;
ALTER TABLE "product_telemetry_events" ADD COLUMN IF NOT EXISTS "assignment_revision" integer;
ALTER TABLE "product_telemetry_events" ADD COLUMN IF NOT EXISTS "expires_at" timestamptz;

DROP TRIGGER IF EXISTS product_telemetry_events_append_only ON "product_telemetry_events";

UPDATE "product_telemetry_events"
SET "subject_pseudonym" = COALESCE("subject_pseudonym", 'sub_' || md5("workspace_id" || ':' || "session_pseudonym") || md5("session_pseudonym" || ':' || "workspace_id")),
    "region_classification" = COALESCE("region_classification", 'unknown'),
    "expires_at" = COALESCE("expires_at", "received_at" + interval '90 days')
WHERE "subject_pseudonym" IS NULL OR "region_classification" IS NULL OR "expires_at" IS NULL;

ALTER TABLE "product_telemetry_events" ALTER COLUMN "subject_pseudonym" SET NOT NULL;
ALTER TABLE "product_telemetry_events" ALTER COLUMN "region_classification" SET NOT NULL;
ALTER TABLE "product_telemetry_events" ALTER COLUMN "expires_at" SET NOT NULL;
ALTER TABLE "product_telemetry_events" DROP CONSTRAINT IF EXISTS "product_telemetry_events_workspace_pseudonym_check";
ALTER TABLE "product_telemetry_events" ADD CONSTRAINT "product_telemetry_events_workspace_pseudonym_check" CHECK (
  "workspace_pseudonym" ~ '^wsp_[a-f0-9]{32,64}$' AND
  "session_pseudonym" ~ '^ses_[a-f0-9]{32,64}$' AND
  "subject_pseudonym" ~ '^sub_[a-f0-9]{64}$' AND
  "region_classification" IN ('mena','non_mena','unknown') AND
  "expires_at" > "received_at" AND
  octet_length("event"::text) <= 8192
);
CREATE INDEX IF NOT EXISTS "product_telemetry_events_expiry_idx" ON "product_telemetry_events" ("expires_at");
CREATE INDEX IF NOT EXISTS "product_telemetry_events_experiment_idx" ON "product_telemetry_events" ("workspace_id", "experiment_id", "subject_pseudonym", "assignment_revision", "name");

CREATE TRIGGER product_telemetry_events_append_only BEFORE UPDATE ON "product_telemetry_events" FOR EACH ROW EXECUTE FUNCTION prevent_release_evidence_mutation();

CREATE TABLE IF NOT EXISTS "experiment_assignments" (
  "workspace_id" text NOT NULL REFERENCES "workspaces"("id") ON DELETE RESTRICT,
  "experiment_id" text NOT NULL,
  "subject_pseudonym" text NOT NULL,
  "assignment_revision" integer NOT NULL,
  "variant" text NOT NULL,
  "assigned_at" timestamptz NOT NULL,
  "expires_at" timestamptz NOT NULL,
  CONSTRAINT "experiment_assignments_pk" PRIMARY KEY ("workspace_id", "experiment_id", "subject_pseudonym", "assignment_revision"),
  CONSTRAINT "experiment_assignments_values_check" CHECK ("experiment_id" ~ '^exp_[A-Za-z0-9_-]{4,80}$' AND "subject_pseudonym" ~ '^sub_[a-f0-9]{64}$' AND "assignment_revision" > 0 AND "expires_at" > "assigned_at")
);
CREATE INDEX IF NOT EXISTS "experiment_assignments_active_idx" ON "experiment_assignments" ("workspace_id", "experiment_id", "subject_pseudonym", "expires_at");
