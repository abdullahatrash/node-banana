-- Issue 15: additive schema hardening for safe rollouts.
-- Keep this migration non-breaking and idempotent.

ALTER TABLE IF EXISTS "social_posts"
  ALTER COLUMN "trigger_source" SET DEFAULT 'manual';

ALTER TABLE IF EXISTS "social_automation_rules"
  ALTER COLUMN "trigger_source" SET DEFAULT 'schedule';

CREATE INDEX IF NOT EXISTS "social_posts_parent_post_idx"
ON "social_posts" ("parent_post_id");

CREATE INDEX IF NOT EXISTS "social_automation_tasks_source_post_idx"
ON "social_automation_tasks" ("source_post_id");

CREATE INDEX IF NOT EXISTS "social_automation_tasks_source_event_idx"
ON "social_automation_tasks" ("source_event_id");

CREATE INDEX IF NOT EXISTS "social_dispatch_runs_post_idx"
ON "social_dispatch_runs" ("post_id");

CREATE INDEX IF NOT EXISTS "social_dispatch_runs_account_idx"
ON "social_dispatch_runs" ("account_id");
