DROP TRIGGER "content_format_definition_revisions_immutable" ON "content_format_definition_revisions";
--> statement-breakpoint
UPDATE "content_format_definition_revisions" SET "status" = 'retired', "retired_at" = '2026-09-04T09:00:00Z'::timestamptz WHERE "revision" = 3 AND "status" = 'active';
--> statement-breakpoint
WITH definitions(format,digest,inputs) AS (VALUES
  ('slideshow','sha256:d5b0fe73679c218db5e110e01f458490b1c2bc57d12349dd1ae5255b50544e39','["recipe","durationSeconds","aspectRatio","contentLanguage","arabicVariety","orderedSources","script","prompt","captionStyle","mediaSetRevisions","themeInstructions"]'::jsonb),
  ('wall_of_text','sha256:038fafbe2d76cafdd5ccc69f8f0808f1a2e948cfab6e90e72d83fd7320eb8bb6','["recipe","durationSeconds","aspectRatio","contentLanguage","arabicVariety","orderedSources","script","prompt","captionStyle","themeInstructions"]'::jsonb),
  ('video_hook_demo','sha256:cb77f71289b2daab419bdba458e253a7fbc45d1b0e1b0ad82be90b404eba60bf','["recipe","durationSeconds","aspectRatio","contentLanguage","arabicVariety","orderedSources","script","prompt","scene","captionStyle","themeInstructions"]'::jsonb),
  ('speaking_hook_demo','sha256:86419de2bde3fcc47643337f3f7bc69add168cd9ab1ed917e28944ed4602a71c','["recipe","durationSeconds","aspectRatio","contentLanguage","arabicVariety","orderedSources","script","prompt","speaker","scene","captionStyle","themeInstructions"]'::jsonb),
  ('talking_head_ugc','sha256:67a20c7da5ee890ad5a96a4c0b1a08a35c58eb231cdc46ff3fe00cf903f12055','["recipe","durationSeconds","aspectRatio","contentLanguage","arabicVariety","orderedSources","script","prompt","speaker","scene","captionStyle","personaId","mediaSetRevisions","themeInstructions"]'::jsonb),
  ('green_screen_meme','sha256:58ffe2ce9e830d3854f40ed06e4a2004219018e303afb60f5d8024feb55bcd93','["recipe","durationSeconds","aspectRatio","contentLanguage","arabicVariety","orderedSources","script","prompt","captionStyle","themeInstructions"]'::jsonb),
  ('talking_head_green_screen','sha256:0c1f1999d0f05fce45962db0a6572e4f2c96c941c158b2dddea3cbb382f8214e','["recipe","durationSeconds","aspectRatio","contentLanguage","arabicVariety","orderedSources","script","prompt","speaker","captionStyle","personaId","themeInstructions"]'::jsonb),
  ('product_spokesperson','sha256:b61c044e157ff0e2f7ecfa63da281d26c70e1f4646d4e00418816fb6c0652673','["recipe","durationSeconds","aspectRatio","contentLanguage","arabicVariety","orderedSources","script","prompt","speaker","scene","captionStyle","personaId","mediaSetRevisions","themeInstructions"]'::jsonb),
  ('green_screen_mobile_app','sha256:e0c7d48baed8021ca3b8463e79790feb888bffc145f5e84ce0dcefdfc5c9b97c','["recipe","durationSeconds","aspectRatio","contentLanguage","arabicVariety","orderedSources","script","prompt","captionStyle","themeInstructions"]'::jsonb),
  ('claymation','sha256:3e1b98fc0adf5ca56e6664eee605a669d55b9cf00117139c8013e23a41f292fa','["recipe","durationSeconds","aspectRatio","contentLanguage","arabicVariety","orderedSources","script","prompt","captionStyle","mediaSetRevisions","themeInstructions"]'::jsonb),
  ('character_swap','sha256:24f05ad0bccbda72dc31b759170bf6181831a16e0e609f1cec9bc6535e9ba0a1','["recipe","durationSeconds","aspectRatio","contentLanguage","arabicVariety","orderedSources","prompt","captionStyle","personaId"]'::jsonb),
  ('custom_upload','sha256:fbf49bf8a5f4f791761f13436ba3b3d5ebef1b4ee2f6676efdd7188591db6d32','[]'::jsonb)
)
INSERT INTO "content_format_definition_revisions" ("definition_id","revision","format","status","document","document_digest","activated_at")
SELECT old."definition_id",4,old."format",'active',
  old."document" || jsonb_build_object(
    'revision',4,
    'execution', CASE WHEN old."format"='custom_upload' THEN old."document"->'execution' ELSE (old."document"->'execution') || jsonb_build_object(
      'workflow', jsonb_build_object('id','tasmeemai_content_'||old."format",'revisionId','builtin-2026-09-04-4','operation','runtime.dispatch_content_'||old."format"||'@1','inputs',definitions.inputs),
      'modelPolicy', jsonb_build_object('id','content.'||old."format"||'.v4','revision',4,'qualifiedModelsOnly',true,'advancedOverrides','compatible_only')
    ) END
  ), definitions.digest, '2026-09-04T09:00:00Z'::timestamptz
FROM "content_format_definition_revisions" old JOIN definitions ON definitions.format=old."format" WHERE old."revision"=3;
--> statement-breakpoint
CREATE TRIGGER "content_format_definition_revisions_immutable" BEFORE UPDATE OR DELETE ON "content_format_definition_revisions" FOR EACH ROW EXECUTE FUNCTION prevent_content_definition_evidence_mutation();
