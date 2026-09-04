ALTER TABLE "creator_persona_training_jobs" ADD COLUMN "input_schema_digest" text;
--> statement-breakpoint
ALTER TABLE "creator_persona_training_jobs" ADD COLUMN "qualification_id" text;
--> statement-breakpoint
ALTER TABLE "creator_persona_training_jobs" ADD COLUMN "qualification_revision" integer;
--> statement-breakpoint
ALTER TABLE "creator_persona_training_jobs" ADD COLUMN "qualification_expires_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "creator_persona_training_jobs" ADD COLUMN "qualification_snapshot" jsonb;
--> statement-breakpoint
ALTER TABLE "creator_persona_training_jobs" ADD COLUMN "quote_amount_usd" text;
--> statement-breakpoint
ALTER TABLE "creator_persona_training_jobs" ADD COLUMN "quote_expires_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "creator_persona_training_jobs" ADD COLUMN "reservation_ids" jsonb;
--> statement-breakpoint
ALTER TABLE "creator_persona_training_jobs" ADD COLUMN "region_policy_id" text;
--> statement-breakpoint
ALTER TABLE "creator_persona_training_jobs" ADD COLUMN "region_policy_version" integer;
--> statement-breakpoint
ALTER TABLE "creator_persona_training_jobs" ADD COLUMN "region_evidence_digest" text;
--> statement-breakpoint
ALTER TABLE "creator_persona_training_jobs" ADD COLUMN "region" text;
--> statement-breakpoint
ALTER TABLE "creator_persona_training_jobs" ADD COLUMN "region_route_id" text;
--> statement-breakpoint
ALTER TABLE "creator_persona_training_jobs" ADD COLUMN "region_evidence_expires_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "creator_persona_training_jobs" ADD COLUMN "retry_of_job_id" text;
--> statement-breakpoint
CREATE TABLE "creator_persona_training_admissions" (
  "workspace_id" text NOT NULL,
  "idempotency_key" text NOT NULL,
  "persona_id" text NOT NULL,
  "expected_revision" integer NOT NULL,
  "job_id" text NOT NULL,
  "operation_id" text NOT NULL,
  "request_digest" text NOT NULL,
  "admission_snapshot" jsonb NOT NULL,
  "retry_of_job_id" text,
  "created_by_user_id" text NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone NOT NULL,
  CONSTRAINT "creator_persona_training_admissions_pk" PRIMARY KEY ("workspace_id", "idempotency_key"),
  CONSTRAINT "creator_persona_training_admissions_job_unique" UNIQUE ("workspace_id", "job_id"),
  CONSTRAINT "creator_persona_training_admissions_digest_check" CHECK ("request_digest" ~ '^sha256:[a-f0-9]{64}$'),
  CONSTRAINT "creator_persona_training_admissions_revision_check" CHECK ("expected_revision" > 0),
  CONSTRAINT "creator_persona_training_admissions_window_check" CHECK ("expires_at" > "created_at")
);
--> statement-breakpoint
ALTER TABLE "creator_persona_training_admissions" ADD CONSTRAINT "creator_persona_training_admissions_persona_fk" FOREIGN KEY ("workspace_id", "persona_id") REFERENCES "public"."creator_personas"("workspace_id", "id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "creator_persona_training_admissions" ADD CONSTRAINT "creator_persona_training_admissions_user_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "creator_persona_training_jobs" ADD CONSTRAINT "creator_persona_training_jobs_retry_fk" FOREIGN KEY ("workspace_id", "retry_of_job_id") REFERENCES "public"."creator_persona_training_jobs"("workspace_id", "id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "creator_persona_training_jobs" ADD CONSTRAINT "creator_persona_training_jobs_admission_complete_check" CHECK (
  ("input_schema_digest" IS NULL AND "qualification_id" IS NULL AND "qualification_revision" IS NULL AND "qualification_expires_at" IS NULL AND "qualification_snapshot" IS NULL AND "quote_amount_usd" IS NULL AND "quote_expires_at" IS NULL AND "reservation_ids" IS NULL AND "region_policy_id" IS NULL AND "region_policy_version" IS NULL AND "region_evidence_digest" IS NULL AND "region" IS NULL AND "region_route_id" IS NULL AND "region_evidence_expires_at" IS NULL)
  OR
  ("input_schema_digest" IS NOT NULL AND "qualification_id" IS NOT NULL AND "qualification_revision" IS NOT NULL AND "qualification_expires_at" IS NOT NULL AND "qualification_snapshot" IS NOT NULL AND "quote_amount_usd" IS NOT NULL AND "quote_expires_at" IS NOT NULL AND "reservation_ids" IS NOT NULL AND "region_policy_id" IS NOT NULL AND "region_policy_version" IS NOT NULL AND "region_evidence_digest" IS NOT NULL AND "region" IS NOT NULL AND "region_route_id" IS NOT NULL AND "region_evidence_expires_at" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "creator_persona_training_jobs" ADD CONSTRAINT "creator_persona_training_jobs_admission_digest_check" CHECK (
  "input_schema_digest" IS NULL OR (
    "input_schema_digest" ~ '^sha256:[a-f0-9]{64}$'
    AND "region_evidence_digest" ~ '^sha256:[a-f0-9]{64}$'
    AND "qualification_revision" > 0
    AND "region_policy_version" > 0
    AND "quote_amount_usd" ~ '^(0|[1-9][0-9]*)(\.[0-9]{1,6})?$'
    AND jsonb_typeof("reservation_ids") = 'array'
    AND jsonb_array_length("reservation_ids") > 0
  )
);
--> statement-breakpoint
CREATE INDEX "creator_persona_training_jobs_retry_idx" ON "creator_persona_training_jobs" ("workspace_id", "retry_of_job_id") WHERE "retry_of_job_id" IS NOT NULL;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION reject_creator_persona_training_admission_plan_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'CREATOR_PERSONA_TRAINING_ADMISSION_PLAN_APPEND_ONLY';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "creator_persona_training_admission_plan_append_only" BEFORE UPDATE OR DELETE ON "creator_persona_training_admissions" FOR EACH ROW EXECUTE FUNCTION reject_creator_persona_training_admission_plan_mutation();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION reject_creator_persona_training_admission_update() RETURNS trigger AS $$
BEGIN
  IF NEW."workspace_id" IS DISTINCT FROM OLD."workspace_id"
    OR NEW."id" IS DISTINCT FROM OLD."id"
    OR NEW."persona_id" IS DISTINCT FROM OLD."persona_id"
    OR NEW."persona_revision" IS DISTINCT FROM OLD."persona_revision"
    OR NEW."provider" IS DISTINCT FROM OLD."provider"
    OR NEW."model" IS DISTINCT FROM OLD."model"
    OR NEW."model_version" IS DISTINCT FROM OLD."model_version"
    OR NEW."qualification_digest" IS DISTINCT FROM OLD."qualification_digest"
    OR NEW."provider_acceptance_evidence_id" IS DISTINCT FROM OLD."provider_acceptance_evidence_id"
    OR NEW."operation_id" IS DISTINCT FROM OLD."operation_id"
    OR NEW."input_schema_digest" IS DISTINCT FROM OLD."input_schema_digest"
    OR NEW."qualification_id" IS DISTINCT FROM OLD."qualification_id"
    OR NEW."qualification_revision" IS DISTINCT FROM OLD."qualification_revision"
    OR NEW."qualification_expires_at" IS DISTINCT FROM OLD."qualification_expires_at"
    OR NEW."qualification_snapshot" IS DISTINCT FROM OLD."qualification_snapshot"
    OR NEW."quote_amount_usd" IS DISTINCT FROM OLD."quote_amount_usd"
    OR NEW."quote_expires_at" IS DISTINCT FROM OLD."quote_expires_at"
    OR NEW."reservation_ids" IS DISTINCT FROM OLD."reservation_ids"
    OR NEW."region_policy_id" IS DISTINCT FROM OLD."region_policy_id"
    OR NEW."region_policy_version" IS DISTINCT FROM OLD."region_policy_version"
    OR NEW."region_evidence_digest" IS DISTINCT FROM OLD."region_evidence_digest"
    OR NEW."region" IS DISTINCT FROM OLD."region"
    OR NEW."region_route_id" IS DISTINCT FROM OLD."region_route_id"
    OR NEW."region_evidence_expires_at" IS DISTINCT FROM OLD."region_evidence_expires_at"
    OR NEW."retry_of_job_id" IS DISTINCT FROM OLD."retry_of_job_id"
    OR NEW."requested_by_user_id" IS DISTINCT FROM OLD."requested_by_user_id"
    OR NEW."created_at" IS DISTINCT FROM OLD."created_at"
  THEN
    RAISE EXCEPTION 'CREATOR_PERSONA_TRAINING_ADMISSION_IMMUTABLE';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "creator_persona_training_admission_immutable" BEFORE UPDATE ON "creator_persona_training_jobs" FOR EACH ROW EXECUTE FUNCTION reject_creator_persona_training_admission_update();
