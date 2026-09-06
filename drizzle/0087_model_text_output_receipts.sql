CREATE TABLE "model_text_output_receipts" (
  "workspace_id" text NOT NULL REFERENCES "workspaces"("id") ON DELETE restrict,
  "id" text NOT NULL,
  "prediction_id" text NOT NULL REFERENCES "replicate_prediction_identities"("prediction_id") ON DELETE restrict,
  "output_index" integer NOT NULL,
  "intent_id" text NOT NULL,
  "content" text NOT NULL,
  "content_digest" text NOT NULL,
  "byte_length" integer NOT NULL,
  "created_at" timestamptz NOT NULL,
  CONSTRAINT "model_text_output_receipts_pk" PRIMARY KEY ("workspace_id", "id"),
  CONSTRAINT "model_text_output_receipts_prediction_output_unique" UNIQUE ("workspace_id", "prediction_id", "output_index"),
  CONSTRAINT "model_text_output_receipts_intent_fk" FOREIGN KEY ("workspace_id", "intent_id") REFERENCES "generation_intents"("workspace_id", "id") ON DELETE restrict,
  CONSTRAINT "model_text_output_receipts_values_check" CHECK ("id" ~ '^text_[a-f0-9]{32}$' AND "output_index" >= 0 AND "byte_length" > 0 AND "byte_length" <= 100000 AND "content_digest" ~ '^sha256:[a-f0-9]{64}$')
);

CREATE INDEX "model_text_output_receipts_intent_idx" ON "model_text_output_receipts" ("workspace_id", "intent_id", "created_at");
REVOKE UPDATE, DELETE ON "model_text_output_receipts" FROM PUBLIC;
