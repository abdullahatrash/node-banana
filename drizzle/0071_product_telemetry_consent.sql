CREATE TABLE IF NOT EXISTS "product_telemetry_consents" (
  "workspace_id" text NOT NULL REFERENCES "workspaces"("id") ON DELETE RESTRICT,
  "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE RESTRICT,
  "revision" integer NOT NULL,
  "purpose" text NOT NULL,
  "status" text NOT NULL,
  "issued_at" timestamptz NOT NULL,
  "expires_at" timestamptz NOT NULL,
  CONSTRAINT "product_telemetry_consents_pk" PRIMARY KEY ("workspace_id", "user_id", "revision"),
  CONSTRAINT "product_telemetry_consents_values_check" CHECK ("revision" > 0 AND "purpose" = 'product_analytics' AND "status" IN ('active','revoked') AND "expires_at" > "issued_at")
);
CREATE INDEX IF NOT EXISTS "product_telemetry_consents_active_idx" ON "product_telemetry_consents" ("workspace_id", "user_id", "status", "expires_at");

CREATE TRIGGER product_telemetry_consents_append_only BEFORE UPDATE OR DELETE ON "product_telemetry_consents" FOR EACH ROW EXECUTE FUNCTION prevent_release_evidence_mutation();
