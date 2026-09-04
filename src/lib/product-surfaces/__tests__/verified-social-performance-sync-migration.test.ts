import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(join(process.cwd(), "drizzle/0121_verified_social_performance_sync.sql"), "utf8");
const guardMigration = readFileSync(join(process.cwd(), "drizzle/0122_performance_sync_active_job_guard.sql"), "utf8");

describe("verified social performance sync schema", () => {
  it("preserves unknown metrics and separates verified provenance", () => {
    expect(migration).toContain('ALTER COLUMN "views" DROP NOT NULL');
    expect(migration).toContain("'platform_verified'");
    expect(migration).toContain('"reported_metrics"');
    expect(migration).toContain('"provider_receipt"');
    expect(migration).toContain("workspace_content_performance_observations_verified_digest_unique");
  });

  it("creates tenant-safe schedules and lease-protected jobs", () => {
    expect(migration).toContain('CREATE TABLE "workspace_content_performance_syncs"');
    expect(migration).toContain('CREATE TABLE "workspace_content_performance_sync_jobs"');
    expect(migration).toContain("workspace_content_performance_syncs_account_fk");
    expect(migration).toContain("workspace_content_performance_sync_jobs_sync_fk");
    expect(migration).toContain("workspace_content_performance_sync_jobs_due_idx");
    expect(guardMigration).toContain("workspace_content_performance_sync_jobs_active_sync_unique");
    expect(migration).toContain('"state" = \'queued\'');
  });
});
