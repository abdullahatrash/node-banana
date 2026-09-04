ALTER TABLE "model_qualification_runs" ADD COLUMN "matrix_id" text NOT NULL DEFAULT 'legacy-unscoped';
--> statement-breakpoint
ALTER TABLE "model_qualification_runs" ADD COLUMN "provider_account_id" text NOT NULL DEFAULT 'legacy-unverified';
--> statement-breakpoint
ALTER TABLE "model_qualification_runs" ADD COLUMN "credential_fingerprint" text NOT NULL DEFAULT 'sha256:0000000000000000000000000000000000000000000000000000000000000000';
--> statement-breakpoint
ALTER TABLE "model_qualification_runs" ADD COLUMN "observed_spend_usd" numeric(14,6) NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "model_qualification_runs" ALTER COLUMN "matrix_id" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "model_qualification_runs" ALTER COLUMN "provider_account_id" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "model_qualification_runs" ALTER COLUMN "credential_fingerprint" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "model_qualification_runs" DROP CONSTRAINT "model_qualification_runs_values_check";
--> statement-breakpoint
ALTER TABLE "model_qualification_runs" ADD CONSTRAINT "model_qualification_runs_values_check" CHECK (
  "request_digest" ~ '^sha256:[a-f0-9]{64}$' AND
  "credential_fingerprint" ~ '^sha256:[a-f0-9]{64}$' AND
  "provider" = 'replicate' AND
  "state" IN ('running','completed','blocked') AND
  "hard_cap_usd" = 0.4 AND "reserved_spend_usd" > 0 AND
  "reserved_spend_usd" < "hard_cap_usd" AND "observed_spend_usd" >= 0
);
--> statement-breakpoint
CREATE INDEX "model_qualification_runs_account_matrix_idx" ON "model_qualification_runs"("provider","provider_account_id","matrix_id","state");
--> statement-breakpoint
ALTER TABLE "model_qualification_cases" ADD COLUMN "observed_spend_usd" numeric(14,6);
--> statement-breakpoint
ALTER TABLE "model_qualification_cases" ADD COLUMN "spend_authorization_id" text NOT NULL DEFAULT 'legacy-unverified';
--> statement-breakpoint
ALTER TABLE "model_qualification_cases" ADD COLUMN "spend_authorization_digest" text NOT NULL DEFAULT 'sha256:0000000000000000000000000000000000000000000000000000000000000000';
--> statement-breakpoint
ALTER TABLE "model_qualification_cases" ALTER COLUMN "spend_authorization_id" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "model_qualification_cases" ALTER COLUMN "spend_authorization_digest" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "model_qualification_cases" ADD COLUMN "spend_receipt_id" text;
--> statement-breakpoint
ALTER TABLE "model_qualification_cases" ADD COLUMN "spend_receipt_digest" text;
--> statement-breakpoint
ALTER TABLE "model_qualification_cases" DROP CONSTRAINT "model_qualification_cases_values_check";
--> statement-breakpoint
ALTER TABLE "model_qualification_cases" ADD CONSTRAINT "model_qualification_cases_values_check" CHECK (
  "request_digest" ~ '^sha256:[a-f0-9]{64}$' AND
  "spend_authorization_digest" ~ '^sha256:[a-f0-9]{64}$' AND
  "state" IN ('reserved','submitting','submitted','outcome_unknown','completed') AND
  "maximum_spend_usd" > 0 AND "maximum_spend_usd" < 0.4 AND
  ("observed_spend_usd" IS NULL OR "observed_spend_usd" >= 0) AND
  ("spend_receipt_digest" IS NULL OR "spend_receipt_digest" ~ '^sha256:[a-f0-9]{64}$') AND
  length("submission_key") BETWEEN 16 AND 300 AND
  ("state" <> 'completed' OR ("prediction_id" IS NOT NULL AND "terminal_status" IN ('succeeded','failed','canceled','aborted') AND "result" IS NOT NULL AND "spend_receipt_id" IS NOT NULL AND "observed_spend_usd" IS NOT NULL AND "completed_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "model_qualification_spend_receipts" (
  "receipt_id" text PRIMARY KEY NOT NULL,
  "run_id" text NOT NULL,
  "case_id" text NOT NULL,
  "matrix_id" text NOT NULL,
  "provider" text NOT NULL,
  "provider_account_id" text NOT NULL,
  "credential_fingerprint" text NOT NULL,
  "prediction_id" text NOT NULL,
  "model" text NOT NULL,
  "model_version" text NOT NULL,
  "currency" text NOT NULL,
  "amount_usd" numeric(14,6) NOT NULL,
  "payload_digest" text NOT NULL,
  "signing_key_id" text NOT NULL,
  "receipt" jsonb NOT NULL,
  "provider_observed_at" timestamptz NOT NULL,
  "received_at" timestamptz NOT NULL,
  CONSTRAINT "model_qualification_spend_receipts_case_fk" FOREIGN KEY("run_id","case_id") REFERENCES "model_qualification_cases"("run_id","case_id") ON DELETE restrict,
  CONSTRAINT "model_qualification_spend_receipts_values_check" CHECK (
    "provider" = 'replicate' AND "currency" = 'USD' AND
    "amount_usd" >= 0 AND
    "credential_fingerprint" ~ '^sha256:[a-f0-9]{64}$' AND
    "payload_digest" ~ '^sha256:[a-f0-9]{64}$'
  )
);
--> statement-breakpoint
CREATE UNIQUE INDEX "model_qualification_spend_receipts_prediction_unique" ON "model_qualification_spend_receipts"("provider","prediction_id");
--> statement-breakpoint
CREATE INDEX "model_qualification_spend_receipts_account_matrix_idx" ON "model_qualification_spend_receipts"("provider","provider_account_id","matrix_id","provider_observed_at");
--> statement-breakpoint
CREATE FUNCTION "prevent_model_qualification_spend_mutation"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'model qualification spend evidence is append-only';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "model_qualification_spend_receipts_immutable" BEFORE UPDATE OR DELETE ON "model_qualification_spend_receipts" FOR EACH ROW EXECUTE FUNCTION "prevent_model_qualification_spend_mutation"();
--> statement-breakpoint
CREATE FUNCTION "prevent_model_qualification_case_spend_rebinding"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."spend_receipt_id" IS NOT NULL AND (
    NEW."spend_receipt_id" IS DISTINCT FROM OLD."spend_receipt_id" OR
    NEW."spend_receipt_digest" IS DISTINCT FROM OLD."spend_receipt_digest" OR
    NEW."observed_spend_usd" IS DISTINCT FROM OLD."observed_spend_usd"
  ) THEN
    RAISE EXCEPTION 'model qualification spend binding is immutable';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "model_qualification_case_spend_binding_immutable" BEFORE UPDATE ON "model_qualification_cases" FOR EACH ROW EXECUTE FUNCTION "prevent_model_qualification_case_spend_rebinding"();
