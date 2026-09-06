CREATE TABLE "model_qualification_spend_authorizations" (
  "authorization_id" text PRIMARY KEY NOT NULL,
  "run_id" text NOT NULL,
  "case_id" text NOT NULL,
  "provider_account_id" text NOT NULL,
  "credential_fingerprint" text NOT NULL,
  "model" text NOT NULL,
  "model_version" text NOT NULL,
  "capability" text NOT NULL,
  "billable_quantity" numeric(14,6) NOT NULL,
  "maximum_amount_usd" numeric(14,6) NOT NULL,
  "pricing_source_digest" text NOT NULL,
  "payload_digest" text NOT NULL,
  "signing_key_id" text NOT NULL,
  "envelope" jsonb NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "created_at" timestamptz NOT NULL,
  CONSTRAINT "model_qualification_spend_authorizations_values_check" CHECK (
    "authorization_id" ~ '^qsa_[a-f0-9]{32}$' AND
    "credential_fingerprint" ~ '^sha256:[a-f0-9]{64}$' AND
    "capability" IN ('text_generation','text_to_image','image_to_image','text_to_video','image_to_video','video_to_video') AND
    "billable_quantity" > 0 AND "maximum_amount_usd" > 0 AND "maximum_amount_usd" < 0.4 AND
    "pricing_source_digest" ~ '^sha256:[a-f0-9]{64}$' AND "payload_digest" ~ '^sha256:[a-f0-9]{64}$' AND
    "envelope"->'authorization'->>'authorizationId' = "authorization_id" AND
    "envelope"->'authorization'->>'pricingSourceDigest' = "pricing_source_digest" AND
    "envelope"->'authorization'->>'source' = 'reviewed-pricing-contract' AND
    "envelope"->'authorization'->>'digest' = "payload_digest" AND
    "envelope"->'signature'->>'keyId' = "signing_key_id" AND
    "expires_at" > "created_at"
  )
);
--> statement-breakpoint
CREATE UNIQUE INDEX "model_qualification_spend_authorizations_run_case_unique" ON "model_qualification_spend_authorizations"("run_id","case_id");
--> statement-breakpoint
CREATE TABLE "model_qualification_spend_evidence_imports" (
  "receipt_id" text PRIMARY KEY NOT NULL,
  "run_id" text NOT NULL,
  "case_id" text NOT NULL,
  "prediction_id" text NOT NULL,
  "provider_evidence_kind" text NOT NULL,
  "provider_evidence_digest" text NOT NULL,
  "payload_digest" text NOT NULL,
  "signing_key_id" text NOT NULL,
  "envelope" jsonb NOT NULL,
  "imported_by" text NOT NULL,
  "provider_observed_at" timestamptz NOT NULL,
  "received_at" timestamptz NOT NULL,
  CONSTRAINT "model_qualification_spend_evidence_imports_case_fk" FOREIGN KEY("run_id","case_id") REFERENCES "model_qualification_cases"("run_id","case_id") ON DELETE restrict,
  CONSTRAINT "model_qualification_spend_evidence_imports_values_check" CHECK (
    "receipt_id" ~ '^qsr_[a-f0-9]{32}$' AND
    "provider_evidence_kind" IN ('replicate_account_usage_export','replicate_invoice','replicate_account_screenshot') AND
    "provider_evidence_digest" ~ '^sha256:[a-f0-9]{64}$' AND "payload_digest" ~ '^sha256:[a-f0-9]{64}$' AND
    "envelope"->'receipt'->>'receiptId' = "receipt_id" AND
    "envelope"->'receipt'->>'predictionId' = "prediction_id" AND
    "envelope"->'receipt'->>'source' = 'replicate-account-billing' AND
    "envelope"->'receipt'->'providerEvidence'->>'kind' = "provider_evidence_kind" AND
    "envelope"->'receipt'->'providerEvidence'->>'scope' = 'exact_prediction_charge' AND
    "envelope"->'receipt'->'providerEvidence'->>'digest' = "provider_evidence_digest" AND
    "envelope"->'receipt'->>'digest' = "payload_digest" AND
    "envelope"->'signature'->>'keyId' = "signing_key_id" AND
    length("imported_by") BETWEEN 3 AND 200
  )
);
--> statement-breakpoint
CREATE UNIQUE INDEX "model_qualification_spend_evidence_imports_prediction_unique" ON "model_qualification_spend_evidence_imports"("prediction_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "model_qualification_spend_evidence_imports_case_unique" ON "model_qualification_spend_evidence_imports"("run_id","case_id");
--> statement-breakpoint
CREATE FUNCTION "prevent_model_qualification_spend_evidence_mutation"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'model qualification spend evidence is append-only';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "model_qualification_spend_authorizations_immutable" BEFORE UPDATE OR DELETE ON "model_qualification_spend_authorizations" FOR EACH ROW EXECUTE FUNCTION "prevent_model_qualification_spend_evidence_mutation"();
--> statement-breakpoint
CREATE TRIGGER "model_qualification_spend_evidence_imports_immutable" BEFORE UPDATE OR DELETE ON "model_qualification_spend_evidence_imports" FOR EACH ROW EXECUTE FUNCTION "prevent_model_qualification_spend_evidence_mutation"();
