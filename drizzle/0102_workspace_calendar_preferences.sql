ALTER TABLE "workspace_settings"
  ADD COLUMN "scheduling_timezone" text DEFAULT 'UTC' NOT NULL,
  ADD COLUMN "scheduling_week_start" integer DEFAULT 1 NOT NULL;

ALTER TABLE "workspace_settings"
  ADD CONSTRAINT "workspace_settings_scheduling_preferences_check"
  CHECK (
    length("scheduling_timezone") BETWEEN 1 AND 100
    AND "scheduling_week_start" BETWEEN 0 AND 6
  );
