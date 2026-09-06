CREATE UNIQUE INDEX "workspace_content_performance_sync_jobs_active_sync_unique" ON "workspace_content_performance_sync_jobs" ("workspace_id","sync_id") WHERE "state" IN ('queued','claimed');
