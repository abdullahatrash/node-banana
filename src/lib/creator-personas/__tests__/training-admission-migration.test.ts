import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("0101 creator persona training admission migration", () => {
  const migration = readFileSync("drizzle/0101_creator_persona_training_admission.sql", "utf8");

  it("persists complete immutable qualification, quote, reservation, region, and retry evidence", () => {
    for (const column of [
      "input_schema_digest", "qualification_id", "qualification_revision", "qualification_expires_at", "qualification_snapshot",
      "quote_amount_usd", "quote_expires_at", "reservation_ids", "region_policy_id", "region_policy_version",
      "region_evidence_digest", "region_route_id", "region_evidence_expires_at", "retry_of_job_id",
    ]) expect(migration).toContain(column);
    expect(migration).toContain("creator_persona_training_jobs_admission_complete_check");
    expect(migration).toContain("creator_persona_training_admission_immutable");
    expect(migration).toContain("CREATOR_PERSONA_TRAINING_ADMISSION_IMMUTABLE");
    expect(migration).toContain("creator_persona_training_admissions");
    expect(migration).toContain("creator_persona_training_admission_plan_append_only");
  });
});
