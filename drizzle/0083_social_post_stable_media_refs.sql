ALTER TABLE "social_posts"
  ADD COLUMN "stable_media_refs" jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE "social_posts"
  ADD CONSTRAINT "social_posts_stable_media_refs_array_check"
  CHECK (jsonb_typeof("stable_media_refs") = 'array');
