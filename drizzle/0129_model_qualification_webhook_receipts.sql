CREATE TABLE "model_qualification_webhook_receipts" (
  "provider" text NOT NULL,
  "event_id" text NOT NULL,
  "run_id" text NOT NULL,
  "case_id" text NOT NULL,
  "submission_key" text NOT NULL,
  "prediction_id" text NOT NULL,
  "model" text NOT NULL,
  "executed_version" text NOT NULL,
  "provider_status" text NOT NULL,
  "payload_digest" text NOT NULL,
  "received_at" timestamptz NOT NULL,
  CONSTRAINT "model_qualification_webhook_receipts_pk" PRIMARY KEY("provider","event_id"),
  CONSTRAINT "model_qualification_webhook_receipts_case_fk" FOREIGN KEY("run_id","case_id") REFERENCES "model_qualification_cases"("run_id","case_id") ON DELETE restrict,
  CONSTRAINT "model_qualification_webhook_receipts_values_check" CHECK (
    "provider" = 'replicate' AND
    length("event_id") BETWEEN 8 AND 200 AND
    length("submission_key") BETWEEN 16 AND 300 AND
    "payload_digest" ~ '^sha256:[a-f0-9]{64}$' AND
    "provider_status" IN ('starting','processing','succeeded','failed','canceled','aborted')
  )
);
--> statement-breakpoint
CREATE INDEX "model_qualification_webhook_receipts_submission_idx" ON "model_qualification_webhook_receipts"("submission_key","received_at");
--> statement-breakpoint
CREATE INDEX "model_qualification_webhook_receipts_prediction_idx" ON "model_qualification_webhook_receipts"("prediction_id","received_at");
--> statement-breakpoint
CREATE FUNCTION "prevent_model_qualification_webhook_mutation"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'model qualification webhook evidence is append-only';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "model_qualification_webhook_receipts_immutable" BEFORE UPDATE OR DELETE ON "model_qualification_webhook_receipts" FOR EACH ROW EXECUTE FUNCTION "prevent_model_qualification_webhook_mutation"();
