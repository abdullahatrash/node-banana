CREATE TABLE "model_qualification_artifact_inspections" (
  "receipt_id" text PRIMARY KEY NOT NULL,
  "run_id" text NOT NULL,
  "case_id" text NOT NULL,
  "prediction_id" text NOT NULL,
  "capability" text NOT NULL,
  "content_language" text NOT NULL,
  "kind" text NOT NULL,
  "content_digest" text NOT NULL,
  "items" jsonb,
  "width" integer,
  "height" integer,
  "duration_seconds" numeric(12,3),
  "fps" numeric(8,3),
  "character_count" integer,
  "output_locator_digest" text NOT NULL,
  "technical_evidence_digest" text NOT NULL,
  "created_at" timestamptz NOT NULL,
  CONSTRAINT "model_qualification_artifact_inspections_case_fk" FOREIGN KEY("run_id","case_id") REFERENCES "model_qualification_cases"("run_id","case_id") ON DELETE restrict,
  CONSTRAINT "model_qualification_artifact_inspections_values_check" CHECK (
    "receipt_id" ~ '^qai_[a-f0-9]{32}$' AND
    "capability" IN ('text_generation','text_to_image','image_to_image','text_to_video','image_to_video','video_to_video') AND
    "content_language" IN ('ar','en') AND
    "kind" IN ('text','media') AND
    "content_digest" ~ '^sha256:[a-f0-9]{64}$' AND
    "output_locator_digest" ~ '^sha256:[a-f0-9]{64}$' AND
    "technical_evidence_digest" ~ '^sha256:[a-f0-9]{64}$' AND
    (("kind" = 'text' AND "character_count" > 0 AND "items" IS NULL AND "width" IS NULL AND "height" IS NULL AND "duration_seconds" IS NULL AND "fps" IS NULL) OR
     ("kind" = 'media' AND jsonb_array_length("items") > 0 AND "width" > 0 AND "height" > 0 AND "character_count" IS NULL))
  )
);
--> statement-breakpoint
CREATE UNIQUE INDEX "model_qualification_artifact_inspections_prediction_unique" ON "model_qualification_artifact_inspections"("prediction_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "model_qualification_artifact_inspections_case_unique" ON "model_qualification_artifact_inspections"("run_id","case_id");
--> statement-breakpoint
CREATE TABLE "model_qualification_artifact_reviews" (
  "receipt_id" text PRIMARY KEY NOT NULL REFERENCES "model_qualification_artifact_inspections"("receipt_id") ON DELETE restrict,
  "decision" text NOT NULL,
  "reviewer_id" text NOT NULL,
  "method" text NOT NULL,
  "observed_languages" text[] NOT NULL,
  "reviewed_content_digest" text NOT NULL,
  "language_evidence_digest" text NOT NULL,
  "notes_digest" text NOT NULL,
  "reviewed_at" timestamptz NOT NULL,
  "created_at" timestamptz NOT NULL,
  CONSTRAINT "model_qualification_artifact_reviews_values_check" CHECK (
    "decision" IN ('accepted','rejected') AND
    length("reviewer_id") BETWEEN 3 AND 200 AND
    "method" IN ('automatic_unicode_script','operator_visual_review','operator_playback_review') AND
    cardinality("observed_languages") BETWEEN 1 AND 2 AND
    "observed_languages" <@ ARRAY['ar','en']::text[] AND
    "reviewed_content_digest" ~ '^sha256:[a-f0-9]{64}$' AND
    "language_evidence_digest" ~ '^sha256:[a-f0-9]{64}$' AND
    "notes_digest" ~ '^sha256:[a-f0-9]{64}$'
  )
);
--> statement-breakpoint
CREATE FUNCTION "prevent_model_qualification_artifact_evidence_mutation"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'model qualification artifact evidence is append-only';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "model_qualification_artifact_inspections_immutable" BEFORE UPDATE OR DELETE ON "model_qualification_artifact_inspections" FOR EACH ROW EXECUTE FUNCTION "prevent_model_qualification_artifact_evidence_mutation"();
--> statement-breakpoint
CREATE TRIGGER "model_qualification_artifact_reviews_immutable" BEFORE UPDATE OR DELETE ON "model_qualification_artifact_reviews" FOR EACH ROW EXECUTE FUNCTION "prevent_model_qualification_artifact_evidence_mutation"();
