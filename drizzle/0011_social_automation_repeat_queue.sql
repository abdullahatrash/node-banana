ALTER TABLE "social_automation_rules"
ADD COLUMN IF NOT EXISTS "repeat_interval_seconds" integer;

ALTER TABLE "social_automation_rules"
ADD COLUMN IF NOT EXISTS "max_runs" integer;

ALTER TABLE "social_automation_rules"
ADD COLUMN IF NOT EXISTS "total_runs" integer NOT NULL DEFAULT 0;

ALTER TABLE "social_automation_tasks"
ADD COLUMN IF NOT EXISTS "task_key" text;

ALTER TABLE "social_automation_tasks"
ADD COLUMN IF NOT EXISTS "run_index" integer NOT NULL DEFAULT 1;

UPDATE "social_automation_tasks"
SET "task_key" = CONCAT("workspace_id", ':', "rule_id", ':', "run_index", ':', "id")
WHERE "task_key" IS NULL;

ALTER TABLE "social_automation_tasks"
ALTER COLUMN "task_key" SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "social_automation_tasks_task_key_unique"
ON "social_automation_tasks" ("task_key");

CREATE UNIQUE INDEX IF NOT EXISTS "social_automation_tasks_rule_run_index_unique"
ON "social_automation_tasks" ("rule_id", "run_index");

CREATE INDEX IF NOT EXISTS "social_automation_tasks_run_index_idx"
ON "social_automation_tasks" ("run_index");
