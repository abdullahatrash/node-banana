CREATE TABLE "model_qualification_runs" (
  "id" text PRIMARY KEY NOT NULL,
  "request_digest" text NOT NULL,
  "provider" text NOT NULL,
  "model" text NOT NULL,
  "model_version" text NOT NULL,
  "signing_key_id" text NOT NULL,
  "state" text NOT NULL,
  "hard_cap_usd" numeric(8,6) NOT NULL,
  "reserved_spend_usd" numeric(8,6) NOT NULL,
  "result" jsonb,
  "created_at" timestamptz NOT NULL,
  "updated_at" timestamptz NOT NULL,
  "completed_at" timestamptz,
  CONSTRAINT "model_qualification_runs_values_check" CHECK (
    "request_digest" ~ '^sha256:[a-f0-9]{64}$' AND "provider" = 'replicate' AND
    "state" IN ('running','completed','blocked') AND "hard_cap_usd" = 0.4 AND
    "reserved_spend_usd" > 0 AND "reserved_spend_usd" < "hard_cap_usd"
  )
);
--> statement-breakpoint
CREATE INDEX "model_qualification_runs_recovery_idx" ON "model_qualification_runs"("state","updated_at","id");
--> statement-breakpoint
CREATE TABLE "model_qualification_cases" (
  "run_id" text NOT NULL REFERENCES "model_qualification_runs"("id") ON DELETE restrict,
  "case_id" text NOT NULL,
  "request_digest" text NOT NULL,
  "state" text NOT NULL,
  "maximum_spend_usd" numeric(8,6) NOT NULL,
  "submission_key" text NOT NULL,
  "prediction_id" text,
  "executed_version" text,
  "terminal_status" text,
  "result" jsonb,
  "lease_owner" text,
  "lease_expires_at" timestamptz,
  "created_at" timestamptz NOT NULL,
  "updated_at" timestamptz NOT NULL,
  "completed_at" timestamptz,
  CONSTRAINT "model_qualification_cases_pk" PRIMARY KEY("run_id","case_id"),
  CONSTRAINT "model_qualification_cases_values_check" CHECK (
    "request_digest" ~ '^sha256:[a-f0-9]{64}$' AND
    "state" IN ('reserved','submitting','submitted','outcome_unknown','completed') AND
    "maximum_spend_usd" > 0 AND "maximum_spend_usd" < 0.4 AND
    length("submission_key") BETWEEN 16 AND 300 AND
    ("state" <> 'completed' OR ("prediction_id" IS NOT NULL AND "terminal_status" IN ('succeeded','failed','canceled','aborted') AND "result" IS NOT NULL AND "completed_at" IS NOT NULL))
  )
);
--> statement-breakpoint
CREATE UNIQUE INDEX "model_qualification_cases_submission_unique" ON "model_qualification_cases"("submission_key");
--> statement-breakpoint
CREATE UNIQUE INDEX "model_qualification_cases_prediction_unique" ON "model_qualification_cases"("prediction_id");
--> statement-breakpoint
CREATE INDEX "model_qualification_cases_recovery_idx" ON "model_qualification_cases"("state","lease_expires_at","updated_at","run_id","case_id");
--> statement-breakpoint
CREATE FUNCTION "prevent_completed_model_qualification_mutation"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR OLD."state" = 'completed' THEN
    RAISE EXCEPTION 'completed model qualification evidence is immutable';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "model_qualification_runs_completed_immutable" BEFORE UPDATE OR DELETE ON "model_qualification_runs" FOR EACH ROW EXECUTE FUNCTION "prevent_completed_model_qualification_mutation"();
--> statement-breakpoint
CREATE TRIGGER "model_qualification_cases_completed_immutable" BEFORE UPDATE OR DELETE ON "model_qualification_cases" FOR EACH ROW EXECUTE FUNCTION "prevent_completed_model_qualification_mutation"();
