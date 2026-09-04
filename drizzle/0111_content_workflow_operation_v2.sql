DROP TRIGGER "content_format_definition_revisions_immutable" ON "content_format_definition_revisions";
--> statement-breakpoint
UPDATE "content_format_definition_revisions" SET "status" = 'retired', "retired_at" = '2026-09-04T11:00:00Z'::timestamptz WHERE "revision" = 4 AND "status" = 'active';
--> statement-breakpoint
WITH definitions(format,digest,inputs) AS (VALUES
  ('slideshow','sha256:8448721292552a596ff01345a56c855ca73e95890240f0b5601de51bf945e3cb','["recipe","durationSeconds","aspectRatio","contentLanguage","arabicVariety","orderedSources","script","prompt","captionStyle","mediaSetRevisions","themeInstructions"]'::jsonb),
  ('wall_of_text','sha256:730d74e431b6ca9be3f72f9fe7cfa3c058854039f6f51cb31b3046a1cbbbb55b','["recipe","durationSeconds","aspectRatio","contentLanguage","arabicVariety","orderedSources","script","prompt","captionStyle","themeInstructions"]'::jsonb),
  ('video_hook_demo','sha256:6f38ef2271fc28e0d0af5abb2c3392270335457ca51910b7e7776cb28024655c','["recipe","durationSeconds","aspectRatio","contentLanguage","arabicVariety","orderedSources","script","prompt","scene","captionStyle","themeInstructions"]'::jsonb),
  ('speaking_hook_demo','sha256:d9c5a3b750c9008da33a219227cc3cd650cc20fa645878bfedad2b85fdbdcd42','["recipe","durationSeconds","aspectRatio","contentLanguage","arabicVariety","orderedSources","script","prompt","speaker","scene","captionStyle","themeInstructions"]'::jsonb),
  ('talking_head_ugc','sha256:cb8e928b836400d642dede14f9a34ab0c8bbbbc3e8ca525615a06cff49c245ac','["recipe","durationSeconds","aspectRatio","contentLanguage","arabicVariety","orderedSources","script","prompt","speaker","scene","captionStyle","personaId","mediaSetRevisions","themeInstructions"]'::jsonb),
  ('green_screen_meme','sha256:e32fb3def99f2a87f56da24b5515d93bc89fa4bf8b75d1d14f6b3347ecf72a76','["recipe","durationSeconds","aspectRatio","contentLanguage","arabicVariety","orderedSources","script","prompt","captionStyle","themeInstructions"]'::jsonb),
  ('talking_head_green_screen','sha256:654b3fe757e733d038be101dc6b6cd0c07eb59b37c55880dd3aeaf8dc27a2aeb','["recipe","durationSeconds","aspectRatio","contentLanguage","arabicVariety","orderedSources","script","prompt","speaker","captionStyle","personaId","themeInstructions"]'::jsonb),
  ('product_spokesperson','sha256:8f09c6c44d89fe0d96e3bb41736f3f7465eef80347d89ea39ec693aafe039567','["recipe","durationSeconds","aspectRatio","contentLanguage","arabicVariety","orderedSources","script","prompt","speaker","scene","captionStyle","personaId","mediaSetRevisions","themeInstructions"]'::jsonb),
  ('green_screen_mobile_app','sha256:6006d1c4205074c9a4e31c5c4ed827d7c49bde8b4b258ec5f4d17e23b35fc463','["recipe","durationSeconds","aspectRatio","contentLanguage","arabicVariety","orderedSources","script","prompt","captionStyle","themeInstructions"]'::jsonb),
  ('claymation','sha256:15790afb099ba0691d442e855791296d1c868de9c7e4b4671e4dcf8f450153b0','["recipe","durationSeconds","aspectRatio","contentLanguage","arabicVariety","orderedSources","script","prompt","captionStyle","mediaSetRevisions","themeInstructions"]'::jsonb),
  ('character_swap','sha256:0fa72dcf9eccdf72aa03f2cf358479a97aa827dfbd2c40a74e958db9704e76a8','["recipe","durationSeconds","aspectRatio","contentLanguage","arabicVariety","orderedSources","prompt","captionStyle","personaId"]'::jsonb),
  ('custom_upload','sha256:f8da0c9879dd9a3b974e9a394ad87fd70cf2d8a1bb6ebc863a7fd0bb33cc25b6','[]'::jsonb)
)
INSERT INTO "content_format_definition_revisions" ("definition_id","revision","format","status","document","document_digest","activated_at")
SELECT old."definition_id",5,old."format",'active',
  old."document" || jsonb_build_object(
    'revision',5,
    'execution', CASE WHEN old."format"='custom_upload' THEN old."document"->'execution' ELSE (old."document"->'execution') || jsonb_build_object(
      'workflow', jsonb_build_object('id','tasmeemai_content_'||old."format",'revisionId','builtin-2026-09-04-5','operation','runtime.dispatch_content_'||old."format"||'@2','inputs',definitions.inputs),
      'modelPolicy', jsonb_build_object('id','content.'||old."format"||'.v5','revision',5,'qualifiedModelsOnly',true,'advancedOverrides','compatible_only')
    ) END
  ), definitions.digest, '2026-09-04T11:00:00Z'::timestamptz
FROM "content_format_definition_revisions" old JOIN definitions ON definitions.format=old."format" WHERE old."revision"=4;
--> statement-breakpoint
CREATE TRIGGER "content_format_definition_revisions_immutable" BEFORE UPDATE OR DELETE ON "content_format_definition_revisions" FOR EACH ROW EXECUTE FUNCTION prevent_content_definition_evidence_mutation();
