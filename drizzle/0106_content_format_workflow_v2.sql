DROP TRIGGER "content_format_definition_revisions_immutable" ON "content_format_definition_revisions";
--> statement-breakpoint
UPDATE "content_format_definition_revisions"
SET "status" = 'retired', "retired_at" = '2026-09-04T03:00:00Z'::timestamptz
WHERE "revision" = 1 AND "status" = 'active';
--> statement-breakpoint
WITH digests(format, digest) AS (VALUES
  ('slideshow','sha256:c509c7a9b2889db1bc9f783cd62fc2832cfa335f58525d7641b8129f28ff2f88'),
  ('wall_of_text','sha256:d37a71d3997db2af4a21f261273fac6649d28481ca06de4ffa1c117fa4b637f7'),
  ('video_hook_demo','sha256:cc079047d7f47a95a820aeb8571f2f3d6085e33d30b4a7639f13e666724073c2'),
  ('speaking_hook_demo','sha256:aaea144ba22743d3985267ac489933ceddaf3d8ba4d31acf5ead35469730bd43'),
  ('talking_head_ugc','sha256:6e2c0ec6c758c47b841c6abb74a3632c73a54a58eef6ff981643e954e57afb15'),
  ('green_screen_meme','sha256:3b956f3840ffe93572d1e62497058355d31800554e9c8b6c81ef9b7b2fe58add'),
  ('talking_head_green_screen','sha256:e5686a49fbb67e5c8822f13b6f78f9ecd170084061d9de84e834bfb742aae855'),
  ('product_spokesperson','sha256:1092545055ecb5a396703359a48c01f6ce212487fd71096f6bcfc3eb9d769bbc'),
  ('green_screen_mobile_app','sha256:5e6104c436436ac3c72f885abe287d8d3242d92c7bd47664566f9f0e8667780d'),
  ('claymation','sha256:f4d60af9c46b5e087e705ebbb3b8167e8e0cdb934c88505cf36833fca70eda96'),
  ('character_swap','sha256:76437a80de0f99c7d677aee38214fbbc8c90d249f55eb74842960902879aca1d'),
  ('custom_upload','sha256:4a95c7d27ff601f274d3ff67a40f4185d17b977345bd3e0c2c3227d0d5af09d0')
)
INSERT INTO "content_format_definition_revisions" ("definition_id", "revision", "format", "status", "document", "document_digest", "activated_at")
SELECT old."definition_id", 2, old."format", 'active',
  old."document" || jsonb_build_object(
    'revision', 2,
    'execution', CASE WHEN old."format" = 'custom_upload'
      THEN jsonb_build_object('strategy','canonical_upload','capability',NULL,'workflow',NULL,'modelPolicy',NULL)
      ELSE (old."document"->'execution') || jsonb_build_object(
        'workflow', jsonb_build_object('id','tasmeemai_content_' || old."format",'revisionId','builtin-2026-09-04-2'),
        'modelPolicy', jsonb_build_object('id','content.' || old."format" || '.v2','revision',2,'qualifiedModelsOnly',true,'advancedOverrides','compatible_only')
      )
    END,
    'renderProof', jsonb_build_object('required',true,'schema','content-render-proof/v2','verifies','["fonts","bidi","captions","timing","safe_areas"]'::jsonb)
  ), digests.digest, '2026-09-04T03:00:00Z'::timestamptz
FROM "content_format_definition_revisions" old
JOIN digests ON digests.format = old."format"
WHERE old."revision" = 1;
--> statement-breakpoint
CREATE TRIGGER "content_format_definition_revisions_immutable" BEFORE UPDATE OR DELETE ON "content_format_definition_revisions" FOR EACH ROW EXECUTE FUNCTION prevent_content_definition_evidence_mutation();
--> statement-breakpoint
CREATE TABLE "content_workflow_generation_runs" (
  "workspace_id" text NOT NULL, "generation_intent_id" text NOT NULL, "generation_operation_id" text NOT NULL,
  "content_piece_id" text NOT NULL, "content_piece_revision" integer NOT NULL,
  "workflow_id" text NOT NULL, "workflow_revision_id" text NOT NULL, "workflow_run_id" text NOT NULL,
  "recipe_digest" text NOT NULL, "selected_model" jsonb NOT NULL, "initiated_by_user_id" text NOT NULL,
  "initiating_auth_context_digest" text NOT NULL, "dispatch_receipt_artifact_id" text,
  "created_at" timestamptz NOT NULL, "updated_at" timestamptz NOT NULL,
  CONSTRAINT "content_workflow_generation_runs_pk" PRIMARY KEY ("workspace_id", "generation_intent_id"),
  CONSTRAINT "content_workflow_generation_runs_run_unique" UNIQUE ("workspace_id", "workflow_run_id"),
  CONSTRAINT "content_workflow_generation_runs_intent_fk" FOREIGN KEY ("workspace_id", "generation_intent_id") REFERENCES "generation_intents"("workspace_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "content_workflow_generation_runs_piece_fk" FOREIGN KEY ("workspace_id", "content_piece_id") REFERENCES "workspace_product_records"("workspace_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "content_workflow_generation_runs_workflow_fk" FOREIGN KEY ("workspace_id", "workflow_id") REFERENCES "content_workflows"("workspace_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "content_workflow_generation_runs_revision_fk" FOREIGN KEY ("workspace_id", "workflow_id", "workflow_revision_id") REFERENCES "content_workflow_revisions"("workspace_id", "workflow_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "content_workflow_generation_runs_run_fk" FOREIGN KEY ("workspace_id", "workflow_id", "workflow_run_id") REFERENCES "workflow_runs"("workspace_id", "workflow_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "content_workflow_generation_runs_user_fk" FOREIGN KEY ("initiated_by_user_id") REFERENCES "user"("id") ON DELETE RESTRICT,
  CONSTRAINT "content_workflow_generation_runs_values_check" CHECK ("content_piece_revision" > 0 AND "recipe_digest" ~ '^sha256:[a-f0-9]{64}$' AND "initiating_auth_context_digest" ~ '^sha256:[a-f0-9]{64}$')
);
