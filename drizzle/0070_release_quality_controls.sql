CREATE TABLE IF NOT EXISTS "release_control_records" (
  "workspace_id" text NOT NULL REFERENCES "workspaces"("id") ON DELETE RESTRICT,
  "kind" text NOT NULL,
  "id" text NOT NULL,
  "revision" integer NOT NULL,
  "build_id" text,
  "document" jsonb NOT NULL,
  "created_by_user_id" text NOT NULL REFERENCES "user"("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL,
  "expires_at" timestamptz,
  CONSTRAINT "release_control_records_pk" PRIMARY KEY ("workspace_id", "kind", "id", "revision"),
  CONSTRAINT "release_control_records_identity_check" CHECK ("id" ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$' AND "revision" > 0 AND octet_length("document"::text) <= 131072),
  CONSTRAINT "release_control_records_kind_check" CHECK ("kind" IN ('evidence','flag','incident','recovery_objective','restore_drill','contract_migration','parity_requirement','experiment'))
);
CREATE INDEX IF NOT EXISTS "release_control_records_current_idx" ON "release_control_records" ("workspace_id", "kind", "id", "revision");
CREATE INDEX IF NOT EXISTS "release_control_records_build_idx" ON "release_control_records" ("workspace_id", "build_id", "kind");

CREATE TABLE IF NOT EXISTS "product_telemetry_events" (
  "workspace_id" text NOT NULL REFERENCES "workspaces"("id") ON DELETE RESTRICT,
  "event_id" text NOT NULL,
  "workspace_pseudonym" text NOT NULL,
  "session_pseudonym" text NOT NULL,
  "name" text NOT NULL,
  "occurred_at" timestamptz NOT NULL,
  "received_at" timestamptz NOT NULL,
  "event" jsonb NOT NULL,
  CONSTRAINT "product_telemetry_events_pk" PRIMARY KEY ("workspace_id", "event_id"),
  CONSTRAINT "product_telemetry_events_workspace_pseudonym_check" CHECK ("workspace_pseudonym" ~ '^wsp_[a-f0-9]{32,64}$' AND "session_pseudonym" ~ '^ses_[a-f0-9]{32,64}$' AND octet_length("event"::text) <= 8192)
);
CREATE INDEX IF NOT EXISTS "product_telemetry_events_pseudonym_time_idx" ON "product_telemetry_events" ("workspace_pseudonym", "occurred_at");
CREATE INDEX IF NOT EXISTS "product_telemetry_events_name_time_idx" ON "product_telemetry_events" ("name", "occurred_at");

CREATE TABLE IF NOT EXISTS "release_control_mutation_receipts" (
  "workspace_id" text NOT NULL REFERENCES "workspaces"("id") ON DELETE RESTRICT,
  "idempotency_key" text NOT NULL,
  "request_digest" text NOT NULL,
  "response" jsonb NOT NULL,
  "created_at" timestamptz NOT NULL,
  CONSTRAINT "release_control_mutation_receipts_pk" PRIMARY KEY ("workspace_id", "idempotency_key"),
  CONSTRAINT "release_control_mutation_receipts_digest_check" CHECK ("request_digest" ~ '^sha256:[a-f0-9]{64}$' AND length("idempotency_key") BETWEEN 8 AND 200)
);
CREATE UNIQUE INDEX IF NOT EXISTS "release_control_mutation_receipts_request_unique" ON "release_control_mutation_receipts" ("workspace_id", "idempotency_key", "request_digest");

-- Telemetry and release evidence are append-only customer evidence. Corrections are new events/revisions.
CREATE OR REPLACE FUNCTION prevent_release_evidence_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'release evidence is append-only';
END;
$$;
DROP TRIGGER IF EXISTS release_control_records_append_only ON "release_control_records";
CREATE TRIGGER release_control_records_append_only BEFORE UPDATE OR DELETE ON "release_control_records" FOR EACH ROW EXECUTE FUNCTION prevent_release_evidence_mutation();
DROP TRIGGER IF EXISTS product_telemetry_events_append_only ON "product_telemetry_events";
CREATE TRIGGER product_telemetry_events_append_only BEFORE UPDATE OR DELETE ON "product_telemetry_events" FOR EACH ROW EXECUTE FUNCTION prevent_release_evidence_mutation();
