CREATE TABLE "content_format_definition_revisions" (
  "definition_id" text NOT NULL,
  "revision" integer NOT NULL,
  "format" text NOT NULL,
  "status" text NOT NULL,
  "document" jsonb NOT NULL,
  "document_digest" text NOT NULL,
  "activated_at" timestamptz,
  "retired_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "content_format_definition_revisions_pk" PRIMARY KEY ("definition_id", "revision"),
  CONSTRAINT "content_format_definition_revisions_values_check" CHECK (
    "definition_id" = 'content-format:' || "format"
    AND "revision" > 0
    AND "status" IN ('draft', 'active', 'retired')
    AND "document_digest" ~ '^sha256:[a-f0-9]{64}$'
    AND (("status" = 'active' AND "activated_at" IS NOT NULL AND "retired_at" IS NULL) OR "status" <> 'active')
  )
);
CREATE INDEX "content_format_definition_revisions_format_status_idx" ON "content_format_definition_revisions" ("format", "status", "revision");
CREATE UNIQUE INDEX "content_format_definition_revisions_one_active" ON "content_format_definition_revisions" ("format") WHERE "status" = 'active';

CREATE TABLE "content_themes" (
  "workspace_id" text NOT NULL REFERENCES "workspaces"("id") ON DELETE RESTRICT,
  "id" text NOT NULL,
  "title" text NOT NULL,
  "state" text NOT NULL,
  "active_revision" integer,
  "created_by_user_id" text NOT NULL REFERENCES "user"("id") ON DELETE RESTRICT,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "archived_at" timestamptz,
  CONSTRAINT "content_themes_pk" PRIMARY KEY ("workspace_id", "id"),
  CONSTRAINT "content_themes_values_check" CHECK ("state" IN ('draft', 'active', 'archived') AND ("active_revision" IS NULL OR "active_revision" > 0))
);
CREATE INDEX "content_themes_state_idx" ON "content_themes" ("workspace_id", "state", "updated_at");

CREATE TABLE "content_theme_revisions" (
  "workspace_id" text NOT NULL,
  "theme_id" text NOT NULL,
  "revision" integer NOT NULL,
  "document" jsonb NOT NULL,
  "document_digest" text NOT NULL,
  "license_evidence_ids" jsonb NOT NULL,
  "license_expires_at" timestamptz,
  "authored_by_user_id" text NOT NULL REFERENCES "user"("id") ON DELETE RESTRICT,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "content_theme_revisions_pk" PRIMARY KEY ("workspace_id", "theme_id", "revision"),
  CONSTRAINT "content_theme_revisions_theme_fk" FOREIGN KEY ("workspace_id", "theme_id") REFERENCES "content_themes"("workspace_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "content_theme_revisions_values_check" CHECK ("revision" > 0 AND "document_digest" ~ '^sha256:[a-f0-9]{64}$' AND jsonb_array_length("license_evidence_ids") > 0)
);
CREATE UNIQUE INDEX "content_theme_revisions_digest_unique" ON "content_theme_revisions" ("workspace_id", "theme_id", "document_digest");
ALTER TABLE "content_themes" ADD CONSTRAINT "content_themes_active_revision_fk" FOREIGN KEY ("workspace_id", "id", "active_revision") REFERENCES "content_theme_revisions"("workspace_id", "theme_id", "revision") ON DELETE RESTRICT;

CREATE TABLE "blitz_similarity_evidence" (
  "workspace_id" text NOT NULL REFERENCES "workspaces"("id") ON DELETE RESTRICT,
  "id" text NOT NULL,
  "blitz_item_id" text NOT NULL,
  "blitz_item_revision" integer NOT NULL,
  "source_asset_id" text NOT NULL REFERENCES "assets"("id") ON DELETE RESTRICT,
  "candidate_asset_id" text NOT NULL REFERENCES "assets"("id") ON DELETE RESTRICT,
  "status" text NOT NULL,
  "evaluator_id" text NOT NULL,
  "evaluator_version" text NOT NULL,
  "evidence" jsonb NOT NULL,
  "evidence_digest" text NOT NULL,
  "evaluated_at" timestamptz NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "blitz_similarity_evidence_pk" PRIMARY KEY ("workspace_id", "id"),
  CONSTRAINT "blitz_similarity_evidence_item_fk" FOREIGN KEY ("workspace_id", "blitz_item_id") REFERENCES "workspace_product_records"("workspace_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "blitz_similarity_evidence_values_check" CHECK ("blitz_item_revision" > 0 AND "status" IN ('passed', 'blocked') AND "evidence_digest" ~ '^sha256:[a-f0-9]{64}$')
);
CREATE UNIQUE INDEX "blitz_similarity_evidence_candidate_unique" ON "blitz_similarity_evidence" ("workspace_id", "blitz_item_id", "blitz_item_revision", "candidate_asset_id");
CREATE INDEX "blitz_similarity_evidence_status_idx" ON "blitz_similarity_evidence" ("workspace_id", "status", "evaluated_at");

CREATE OR REPLACE FUNCTION prevent_content_definition_evidence_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'versioned content definition evidence is immutable'; END; $$;
CREATE TRIGGER content_format_definition_revisions_immutable BEFORE UPDATE OR DELETE ON "content_format_definition_revisions" FOR EACH ROW EXECUTE FUNCTION prevent_content_definition_evidence_mutation();
CREATE TRIGGER content_theme_revisions_immutable BEFORE UPDATE OR DELETE ON "content_theme_revisions" FOR EACH ROW EXECUTE FUNCTION prevent_content_definition_evidence_mutation();
CREATE TRIGGER blitz_similarity_evidence_immutable BEFORE UPDATE OR DELETE ON "blitz_similarity_evidence" FOR EACH ROW EXECUTE FUNCTION prevent_content_definition_evidence_mutation();

WITH seeds(format, digest, controls, required_controls, source_slots, capability, captions_required) AS (VALUES
  ('slideshow','sha256:a408f901e1614502d9389b4c135f2183b17273bce9a3fa0d80c681ea5a1456df','["script","prompt","source_images","captions","media_sets","theme"]'::jsonb,'["script","source_images","captions"]'::jsonb,'[{"key":"images","type":"image","minimum":1,"maximum":20,"providerInputIndex":0}]'::jsonb,'image_to_video',true),
  ('wall_of_text','sha256:9852c3ad6983892f7f56bdecd801fd6508448ac8935010b0ac5df62014d0f5cb','["script","prompt","source_video","captions","theme"]'::jsonb,'["script","source_video","captions"]'::jsonb,'[{"key":"video","type":"video","minimum":1,"maximum":1,"providerInputIndex":0}]'::jsonb,'video_to_video',true),
  ('video_hook_demo','sha256:3de29e6bd0e80d40b6682059068963327735084078b4c753552dfb25149a4516','["script","prompt","source_video","captions","scene","theme"]'::jsonb,'["script","source_video","captions"]'::jsonb,'[{"key":"video","type":"video","minimum":1,"maximum":1,"providerInputIndex":0}]'::jsonb,'video_to_video',true),
  ('speaking_hook_demo','sha256:5459efe231422af5a462eec6e117a7ecd4494d10421dca75299c8966a6cd5020','["script","prompt","source_video","speaker","scene","captions","theme"]'::jsonb,'["script","source_video","speaker","captions"]'::jsonb,'[{"key":"video","type":"video","minimum":1,"maximum":1,"providerInputIndex":0}]'::jsonb,'video_to_video',true),
  ('talking_head_ugc','sha256:8fa1271b8848b90d96ae1288a05a1b837901ae68567c0c6238dd13b6d21403bd','["script","prompt","persona","speaker","scene","captions","media_sets","theme"]'::jsonb,'["script","persona","speaker","scene","captions"]'::jsonb,'[]'::jsonb,'text_to_video',true),
  ('green_screen_meme','sha256:3e359113795874e954f86785e89fd2805a48b977de3441d93d93f199e7926012','["script","prompt","source_images","source_video","captions","theme"]'::jsonb,'["script","source_images","source_video","captions"]'::jsonb,'[{"key":"images","type":"image","minimum":1,"maximum":1,"providerInputIndex":null},{"key":"video","type":"video","minimum":1,"maximum":1,"providerInputIndex":1}]'::jsonb,'video_to_video',true),
  ('talking_head_green_screen','sha256:0b8b340abe3e23c853ab0882528743d1357bfe6214770289a496b98009996662','["script","prompt","persona","source_video","speaker","captions","theme"]'::jsonb,'["script","persona","source_video","captions"]'::jsonb,'[{"key":"video","type":"video","minimum":1,"maximum":1,"providerInputIndex":0}]'::jsonb,'video_to_video',true),
  ('product_spokesperson','sha256:757f34c883f60eb0855c142d43ce865bab0af494ef0c1718aa87683f046d4f1d','["script","prompt","persona","source_images","speaker","scene","captions","media_sets","theme"]'::jsonb,'["script","persona","source_images","speaker","captions"]'::jsonb,'[{"key":"images","type":"image","minimum":1,"maximum":8,"providerInputIndex":0}]'::jsonb,'image_to_video',true),
  ('green_screen_mobile_app','sha256:5e72cae52b49267fda565b36c7439067d4a47168e36bcb75d73cd5a32e5d1f73','["script","prompt","app_capture","captions","theme"]'::jsonb,'["script","app_capture","captions"]'::jsonb,'[{"key":"app_capture","type":"image","minimum":1,"maximum":1,"providerInputIndex":0}]'::jsonb,'image_to_video',true),
  ('claymation','sha256:26d3a33540a269b91e2f2becd6cd86545f3a424aa0f675b924e6d88dbad5b825','["script","prompt","source_images","captions","media_sets","theme"]'::jsonb,'["script","source_images","captions"]'::jsonb,'[{"key":"images","type":"image","minimum":1,"maximum":8,"providerInputIndex":0}]'::jsonb,'image_to_video',true),
  ('character_swap','sha256:58df94fe93471949a361793ec507d6842fc2000c4efea8d38434f58ab5ab52a5','["prompt","source_video","persona","captions"]'::jsonb,'["source_video","persona"]'::jsonb,'[{"key":"video","type":"video","minimum":1,"maximum":1,"providerInputIndex":0}]'::jsonb,'video_to_video',false),
  ('custom_upload','sha256:4f350cb378bdf027be1141faab70fe04286ef9827cd9048d360d99f043078cc2','["source_video","captions","theme"]'::jsonb,'["source_video"]'::jsonb,'[{"key":"video","type":"video","minimum":1,"maximum":1,"providerInputIndex":0}]'::jsonb,NULL,false)
)
INSERT INTO "content_format_definition_revisions" ("definition_id", "revision", "format", "status", "document", "document_digest", "activated_at")
SELECT 'content-format:' || format, 1, format, 'active',
  jsonb_build_object(
    'schema','content-format-definition/v1','id','content-format:' || format,'revision',1,'format',format,'status','active',
    'controls',controls,'requiredControls',required_controls,'sourceSlots',source_slots,
    'languages',jsonb_build_object('content','["ar","en","mixed"]'::jsonb,'arabicVarieties','["msa","gulf","egyptian","levantine","maghrebi"]'::jsonb,'unsupportedFallback','block'),
    'layout',jsonb_build_object('aspectRatios','["9:16"]'::jsonb,'defaultAspectRatio','9:16','approximatePreview',true,'safeAreaPreset','short-form-v1'),
    'duration',jsonb_build_object('minimumSeconds',4,'maximumSeconds',60,'defaultSeconds',15),
    'captions',jsonb_build_object('required',captions_required,'styles','["brand","minimal","bold","karaoke"]'::jsonb,'bidiProofRequired',true,'fontFallback','block'),
    'execution',CASE WHEN capability IS NULL THEN jsonb_build_object('strategy','canonical_upload','capability',NULL,'workflow',NULL,'modelPolicy',NULL) ELSE jsonb_build_object('strategy','admitted_generation','capability',capability,'workflow',jsonb_build_object('id','tasmeemai.content.' || format,'revisionId','builtin-2026-09-04.1'),'modelPolicy',jsonb_build_object('id','content.' || format || '.v1','revision',1,'qualifiedModelsOnly',true,'advancedOverrides','compatible_only')) END,
    'managedQuote',jsonb_build_object('required',capability IS NOT NULL,'acceptance','explicit_before_admission','maximumQuantity',60),
    'renderProof',jsonb_build_object('required',true,'schema','content-render-proof/v1','verifies','["fonts","bidi","captions","timing","safe_areas"]'::jsonb),
    'editorHandoff',jsonb_build_object('enabled',true,'routeTemplate','/editor/{assetId}','requiresPassedRenderProof',true),
    'outputs','["candidate_asset","immutable_content_revision","lineage_receipt"]'::jsonb
  ), digest, '2026-09-04T00:00:00Z'::timestamptz
FROM seeds;
