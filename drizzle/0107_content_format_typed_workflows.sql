CREATE TABLE "content_model_policy_revisions" (
  "workspace_id" text NOT NULL REFERENCES "workspaces"("id") ON DELETE RESTRICT,
  "id" text NOT NULL,
  "revision" integer NOT NULL,
  "format" text NOT NULL,
  "status" text NOT NULL,
  "policy" jsonb NOT NULL,
  "policy_digest" text NOT NULL,
  "created_at" timestamptz NOT NULL,
  CONSTRAINT "content_model_policy_revisions_pk" PRIMARY KEY ("workspace_id","id","revision"),
  CONSTRAINT "content_model_policy_revisions_values_check" CHECK ("revision" > 0 AND "status" IN ('active','retired') AND "policy_digest" ~ '^sha256:[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE UNIQUE INDEX "content_model_policy_revisions_active_unique" ON "content_model_policy_revisions" ("workspace_id","format") WHERE "status" = 'active';
--> statement-breakpoint
CREATE FUNCTION prevent_content_model_policy_evidence_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'content model policy evidence is immutable'; END; $$;
--> statement-breakpoint
CREATE TRIGGER "content_model_policy_revisions_immutable" BEFORE UPDATE OR DELETE ON "content_model_policy_revisions" FOR EACH ROW EXECUTE FUNCTION prevent_content_model_policy_evidence_mutation();
--> statement-breakpoint
DROP TRIGGER "content_format_definition_revisions_immutable" ON "content_format_definition_revisions";
--> statement-breakpoint
UPDATE "content_format_definition_revisions" SET "status" = 'retired', "retired_at" = '2026-09-04T05:00:00Z'::timestamptz WHERE "revision" = 2 AND "status" = 'active';
--> statement-breakpoint
WITH definitions(format,digest,inputs) AS (VALUES
  ('slideshow','sha256:7a1b3372ff2a4ad24a1c782f49d21293108f94506b8c08264c3a7025ae971743','["recipe","durationSeconds","aspectRatio","contentLanguage","arabicVariety","orderedSources","script","prompt","captionStyle","mediaSetIds","themeRevisionRefs"]'::jsonb),
  ('wall_of_text','sha256:8fe81294df6bc7ae41c4cea966af05f23e2eeae25da333cf095e1a4c2338bd2a','["recipe","durationSeconds","aspectRatio","contentLanguage","arabicVariety","orderedSources","script","prompt","captionStyle","themeRevisionRefs"]'::jsonb),
  ('video_hook_demo','sha256:9dfb50ec915234da05efc3e83be59607e558e4f4563a8797d2f08c59e6bf442e','["recipe","durationSeconds","aspectRatio","contentLanguage","arabicVariety","orderedSources","script","prompt","scene","captionStyle","themeRevisionRefs"]'::jsonb),
  ('speaking_hook_demo','sha256:7ad24c65040baedc7e68aefebfa2a641c1836cced5178c960878ef42afa983c6','["recipe","durationSeconds","aspectRatio","contentLanguage","arabicVariety","orderedSources","script","prompt","speaker","scene","captionStyle","themeRevisionRefs"]'::jsonb),
  ('talking_head_ugc','sha256:424a9ce5d2c41a3198de29c0eb67125c906bac82b4740c3ba45364d7d5a4416b','["recipe","durationSeconds","aspectRatio","contentLanguage","arabicVariety","orderedSources","script","prompt","speaker","scene","captionStyle","personaId","mediaSetIds","themeRevisionRefs"]'::jsonb),
  ('green_screen_meme','sha256:5ca6a046abad32ce883f94ecb3148c6c05fb0ea383e5db8bf93388137b21bb51','["recipe","durationSeconds","aspectRatio","contentLanguage","arabicVariety","orderedSources","script","prompt","captionStyle","themeRevisionRefs"]'::jsonb),
  ('talking_head_green_screen','sha256:b3a320bddb881110ece35b0328b1b6b526f6e1f52f4d8e3f850504cf5b92a360','["recipe","durationSeconds","aspectRatio","contentLanguage","arabicVariety","orderedSources","script","prompt","speaker","captionStyle","personaId","themeRevisionRefs"]'::jsonb),
  ('product_spokesperson','sha256:ce5056126509ac890970cb477737defa8672e856f02a56f2deb43fc67d6d72c3','["recipe","durationSeconds","aspectRatio","contentLanguage","arabicVariety","orderedSources","script","prompt","speaker","scene","captionStyle","personaId","mediaSetIds","themeRevisionRefs"]'::jsonb),
  ('green_screen_mobile_app','sha256:484f9eb26e6e21029d8280dc22d3dc6f61ddb272c307ae3c4141aae813579319','["recipe","durationSeconds","aspectRatio","contentLanguage","arabicVariety","orderedSources","script","prompt","captionStyle","themeRevisionRefs"]'::jsonb),
  ('claymation','sha256:5d173a990ebee811487d699d8978dcc5d9fd9c306b821f435776d74852238283','["recipe","durationSeconds","aspectRatio","contentLanguage","arabicVariety","orderedSources","script","prompt","captionStyle","mediaSetIds","themeRevisionRefs"]'::jsonb),
  ('character_swap','sha256:35ab93dea50c622476ba256876133c8be8cadd1773f0cc76df8ea18272306ee9','["recipe","durationSeconds","aspectRatio","contentLanguage","arabicVariety","orderedSources","prompt","captionStyle","personaId"]'::jsonb),
  ('custom_upload','sha256:2291426d6997a97114c96a1c8c4f27cbeeaeb44d385dcdda7a6fee365e5022cf','["recipe","durationSeconds","aspectRatio","contentLanguage","arabicVariety","orderedSources","captionStyle","themeRevisionRefs"]'::jsonb)
)
INSERT INTO "content_format_definition_revisions" ("definition_id","revision","format","status","document","document_digest","activated_at")
SELECT old."definition_id",3,old."format",'active',
  old."document" || jsonb_build_object(
    'revision',3,
    'execution', CASE WHEN old."format"='custom_upload' THEN old."document"->'execution' ELSE (old."document"->'execution') || jsonb_build_object(
      'workflow', jsonb_build_object('id','tasmeemai_content_'||old."format",'revisionId','builtin-2026-09-04-3','operation','runtime.dispatch_content_'||old."format"||'@1','inputs',definitions.inputs),
      'modelPolicy', jsonb_build_object('id','content.'||old."format"||'.v3','revision',3,'qualifiedModelsOnly',true,'advancedOverrides','compatible_only')
    ) END
  ), definitions.digest, '2026-09-04T05:00:00Z'::timestamptz
FROM "content_format_definition_revisions" old JOIN definitions ON definitions.format=old."format" WHERE old."revision"=2;
--> statement-breakpoint
CREATE TRIGGER "content_format_definition_revisions_immutable" BEFORE UPDATE OR DELETE ON "content_format_definition_revisions" FOR EACH ROW EXECUTE FUNCTION prevent_content_definition_evidence_mutation();
