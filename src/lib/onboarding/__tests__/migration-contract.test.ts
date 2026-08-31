import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(process.cwd(), "drizzle/0053_fearless_lightspeed.sql"),
  "utf8",
);
const dispatchMigration = readFileSync(
  resolve(process.cwd(), "drizzle/0054_first_betty_ross.sql"),
  "utf8",
);
const analyticsMigration = readFileSync(
  resolve(process.cwd(), "drizzle/0055_amazing_lake.sql"),
  "utf8",
);
const correctionMigration = readFileSync(
  resolve(process.cwd(), "drizzle/0056_marvelous_black_bolt.sql"),
  "utf8",
);
const correctionForeignKeyMigration = readFileSync(
  resolve(process.cwd(), "drizzle/0057_same_demogoblin.sql"),
  "utf8",
);

describe("onboarding persistence migration", () => {
  it("creates the onboarding and Brand Profile authority", () => {
    for (const table of [
      "user_preferences",
      "onboarding_sessions",
      "brand_sources",
      "brand_analysis_runs",
      "brand_profiles",
      "onboarding_activation_artifacts",
      "onboarding_command_receipts",
    ]) {
      expect(migration).toContain(`CREATE TABLE "${table}"`);
    }
    expect(migration).toContain(
      'ALTER TABLE "workspace_settings" ADD COLUMN "default_content_language"',
    );
  });

  it("commits a constrained and recoverable workflow dispatch intent", () => {
    expect(dispatchMigration).toContain(
      'CREATE TABLE "onboarding_analysis_dispatch_intents"',
    );
    expect(dispatchMigration).toContain("onboarding_analysis_dispatch_status_check");
    expect(dispatchMigration).toContain("onboarding_analysis_dispatch_attempts_check");
    expect(dispatchMigration).toContain(
      "onboarding_analysis_dispatch_workspace_status_idx",
    );
  });

  it("stores only constrained onboarding funnel telemetry", () => {
    expect(analyticsMigration).toContain('CREATE TABLE "onboarding_analytics_events"');
    for (const constraint of [
      "onboarding_analytics_event_name_check",
      "onboarding_analytics_step_check",
      "onboarding_analytics_source_kind_check",
      "onboarding_analytics_stage_check",
      "onboarding_analytics_locale_check",
      "onboarding_analytics_duration_check",
      "onboarding_analytics_failure_code_check",
    ]) {
      expect(analyticsMigration).toContain(constraint);
    }
    expect(analyticsMigration).not.toContain("jsonb");
  });

  it("stores corrected profiles as linked immutable revisions", () => {
    expect(correctionMigration).toContain('ADD COLUMN "source_profile_id" text');
    expect(correctionMigration).toContain("DROP NOT NULL");
    expect(correctionForeignKeyMigration).toContain(
      'CONSTRAINT "brand_profiles_source_profile_id_fk"',
    );
  });

  it("indexes every queryable foreign key and lifecycle lookup", () => {
    for (const indexName of [
      "onboarding_sessions_workspace_idx",
      "onboarding_sessions_status_idx",
      "brand_sources_workspace_created_idx",
      "brand_sources_created_by_idx",
      "brand_analysis_runs_workspace_status_idx",
      "brand_analysis_runs_source_idx",
      "brand_analysis_runs_retry_idx",
      "brand_profiles_accepted_by_idx",
      "onboarding_activation_artifacts_profile_idx",
    ]) {
      expect(migration).toContain(indexName);
    }
  });

  it("allows only one active Brand Profile per Workspace", () => {
    expect(migration).toContain("brand_profiles_active_workspace_unique");
    expect(migration).toContain(
      `WHERE "brand_profiles"."status" = 'active'`,
    );
  });

  it("guards revisions, schema versions, source shape, and receipt fingerprints", () => {
    for (const constraint of [
      "onboarding_sessions_revision_check",
      "brand_sources_revision_check",
      "brand_sources_extracted_bytes_check",
      "brand_sources_shape_check",
      "brand_profiles_revision_check",
      "brand_profiles_schema_version_check",
      "onboarding_activation_artifacts_schema_version_check",
      "onboarding_command_receipts_fingerprint_check",
      "onboarding_command_receipts_revision_check",
      "user_preferences_interface_locale_check",
    ]) {
      expect(migration).toContain(constraint);
    }
  });
});
