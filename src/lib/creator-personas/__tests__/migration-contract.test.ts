import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Creator Persona migration", () => {
  it("keeps safety evidence, sources, operations, usage, events, and idempotency durable", () => {
    const sql = readFileSync("drizzle/0089_creator_persona_lifecycle.sql", "utf8");
    for (const name of ["creator_personas", "creator_persona_evidence", "creator_persona_training_sources", "creator_persona_training_jobs", "creator_persona_usages", "creator_persona_events", "creator_persona_command_receipts", "qualification_digest", "provider_acceptance_evidence_id", "consent_evidence_id", "operation_id"]) expect(sql).toContain(name);
    expect(sql).toContain("creator_persona_training_jobs_operation_unique");
    expect(sql).toContain("creator_personas_workspace_state_cursor_idx");
  });
});
