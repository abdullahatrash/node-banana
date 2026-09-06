CREATE TABLE "inspiration_rights_evidence" (
  "workspace_id" text NOT NULL REFERENCES "workspaces"("id") ON DELETE RESTRICT,
  "id" text NOT NULL,
  "source_asset_id" text NOT NULL REFERENCES "assets"("id") ON DELETE RESTRICT,
  "source_digest" text NOT NULL,
  "evidence" jsonb NOT NULL,
  "digest" text NOT NULL,
  "basis" text NOT NULL,
  "permitted_remix" text NOT NULL,
  "evidence_document_asset_id" text REFERENCES "assets"("id") ON DELETE RESTRICT,
  "issuer_type" text NOT NULL,
  "issuer_id" text NOT NULL,
  "verified_by_user_id" text NOT NULL REFERENCES "user"("id") ON DELETE RESTRICT,
  "issued_at" timestamptz NOT NULL,
  "verified_at" timestamptz NOT NULL,
  "expires_at" timestamptz,
  "created_at" timestamptz NOT NULL,
  CONSTRAINT "inspiration_rights_evidence_pk" PRIMARY KEY ("workspace_id", "id"),
  CONSTRAINT "inspiration_rights_evidence_values_check" CHECK (
    "source_digest" ~ '^sha256:[a-f0-9]{64}$' AND "digest" ~ '^sha256:[a-f0-9]{64}$' AND
    "basis" IN ('owned','licensed','public_domain','consented') AND
    "permitted_remix" IN ('reference_only','transform','derivative') AND
    "issuer_type" IN ('workspace_asset_owner','license_authority','rights_holder','public_registry') AND
    "verified_at" >= "issued_at" AND ("expires_at" IS NULL OR "expires_at" > "verified_at")
  )
);
CREATE INDEX "inspiration_rights_evidence_source_idx" ON "inspiration_rights_evidence" ("workspace_id", "source_asset_id", "expires_at");
CREATE UNIQUE INDEX "inspiration_rights_evidence_digest_unique" ON "inspiration_rights_evidence" ("workspace_id", "digest");

CREATE OR REPLACE FUNCTION prevent_inspiration_rights_evidence_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'inspiration rights evidence is immutable'; END; $$;
CREATE TRIGGER inspiration_rights_evidence_immutable
BEFORE UPDATE OR DELETE ON "inspiration_rights_evidence"
FOR EACH ROW EXECUTE FUNCTION prevent_inspiration_rights_evidence_mutation();

ALTER TABLE "model_artifact_ingestion_receipts" ADD COLUMN "lease_epoch" integer NOT NULL DEFAULT 1;
ALTER TABLE "model_artifact_ingestion_receipts" DROP CONSTRAINT "model_artifact_ingestion_receipts_value_check";
ALTER TABLE "model_artifact_ingestion_receipts" ADD CONSTRAINT "model_artifact_ingestion_receipts_value_check" CHECK (
  "output_index" >= 0 AND "lease_epoch" > 0 AND "status" IN ('claimed','ready') AND
  ("status" <> 'ready' OR ("asset_id" IS NOT NULL AND "content_digest" ~ '^sha256:[a-f0-9]{64}$' AND "size_bytes" > 0 AND "width" > 0 AND "height" > 0))
);

CREATE TABLE "model_provider_webhook_receipts" (
  "workspace_id" text NOT NULL REFERENCES "workspaces"("id") ON DELETE RESTRICT,
  "provider" text NOT NULL,
  "event_id" text NOT NULL,
  "prediction_id" text NOT NULL REFERENCES "replicate_prediction_identities"("prediction_id") ON DELETE RESTRICT,
  "payload_digest" text NOT NULL,
  "status" text NOT NULL,
  "received_at" timestamptz NOT NULL,
  "processed_at" timestamptz,
  CONSTRAINT "model_provider_webhook_receipts_pk" PRIMARY KEY ("provider", "event_id"),
  CONSTRAINT "model_provider_webhook_receipts_values_check" CHECK (
    "provider" = 'replicate' AND length("event_id") BETWEEN 8 AND 200 AND
    "payload_digest" ~ '^sha256:[a-f0-9]{64}$' AND "status" IN ('received','processed','failed')
  )
);
CREATE INDEX "model_provider_webhook_receipts_prediction_idx" ON "model_provider_webhook_receipts" ("workspace_id", "prediction_id", "received_at");
