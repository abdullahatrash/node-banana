ALTER TABLE "generation_intents" ADD COLUMN "region_admission" jsonb;
ALTER TABLE "generation_intents" ADD CONSTRAINT "generation_intents_region_admission_check" CHECK("region_admission" IS NULL OR (jsonb_typeof("region_admission") = 'object' AND ("region_admission"->>'policyVersion')::integer > 0 AND "region_admission"->>'evidenceDigest' ~ '^sha256:[a-f0-9]{64}$' AND length("region_admission"->>'routeId') > 0 AND ("region_admission"->>'evidenceExpiresAt')::timestamptz IS NOT NULL));
--> statement-breakpoint
CREATE TABLE "model_artifact_ingestion_receipts" (
  "workspace_id" text NOT NULL REFERENCES "workspaces"("id") ON DELETE restrict,
  "prediction_id" text NOT NULL REFERENCES "replicate_prediction_identities"("prediction_id") ON DELETE restrict,
  "output_index" integer NOT NULL,
  "intent_id" text NOT NULL,
  "status" text NOT NULL,
  "storage_key" text NOT NULL,
  "asset_id" text REFERENCES "assets"("id") ON DELETE restrict,
  "lease_owner" text,
  "lease_expires_at" timestamp with time zone,
  "mime_type" text,
  "size_bytes" bigint,
  "width" integer,
  "height" integer,
  "duration_seconds" numeric(12,3),
  "fps" numeric(8,3),
  "content_digest" text,
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL,
  CONSTRAINT "model_artifact_ingestion_receipts_pk" PRIMARY KEY("workspace_id", "prediction_id", "output_index"),
  CONSTRAINT "model_artifact_ingestion_receipts_intent_fk" FOREIGN KEY("workspace_id", "intent_id") REFERENCES "generation_intents"("workspace_id", "id") ON DELETE restrict,
  CONSTRAINT "model_artifact_ingestion_receipts_value_check" CHECK("output_index" >= 0 AND "status" IN ('claimed','ready') AND ("status" <> 'ready' OR ("asset_id" IS NOT NULL AND "content_digest" ~ '^sha256:[a-f0-9]{64}$' AND "size_bytes" > 0 AND "width" > 0 AND "height" > 0)))
);
CREATE UNIQUE INDEX "model_artifact_ingestion_receipts_asset_unique" ON "model_artifact_ingestion_receipts"("asset_id") WHERE "asset_id" IS NOT NULL;
CREATE UNIQUE INDEX "model_artifact_ingestion_receipts_storage_unique" ON "model_artifact_ingestion_receipts"("storage_key");
