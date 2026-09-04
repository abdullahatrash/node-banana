import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CONTENT_FORMATS } from "../definitions";
import { contentFormatDefinition } from "../content-format-definition";
import { canonicalDigest } from "@/lib/agent-tools/canonical";

const migration = readFileSync("drizzle/0100_content_format_definitions_and_similarity.sql", "utf8");
const v2 = readFileSync("drizzle/0106_content_format_workflow_v2.sql", "utf8");
const v3 = readFileSync("drizzle/0107_content_format_typed_workflows.sql", "utf8");
const v4 = readFileSync("drizzle/0108_content_resource_bindings.sql", "utf8");
const policySupersession = readFileSync("drizzle/0109_content_model_policy_supersession.sql", "utf8");

describe("Content format persistence migration", () => {
  it("seeds every observed format as an exact active revision", () => {
    for (const format of CONTENT_FORMATS) {
      expect(migration).toContain(`('${format}','sha256:`);
    }
    expect(migration).toContain("content_format_definition_revisions_one_active");
    expect(migration).toContain("content_format_definition_revisions_immutable");
  });

  it("retires v1 and persists v2 Workflow, Model Policy, Render Proof, and lineage", () => {
    expect(v2).toContain("SET \"status\" = 'retired'");
    expect(v2).toContain("'content-render-proof/v2'");
    expect(v2).toContain("'builtin-2026-09-04-2'");
    expect(v2).toContain('CREATE TABLE "content_workflow_generation_runs"');
  });

  it("retires v2 and persists distinct typed workflows plus immutable exact model policies", () => {
    expect(v3).toContain("WHERE \"revision\" = 2");
    expect(v3).toContain("runtime.dispatch_content_");
    expect(v3).toContain("builtin-2026-09-04-3");
    expect(v3).toContain('CREATE TABLE "content_model_policy_revisions"');
    expect(v3).toContain("content_model_policy_revisions_immutable");
  });

  it("retires v3 and replaces opaque resource ids with exact resource bindings", () => {
    expect(v4).toContain("WHERE \"revision\" = 3");
    expect(v4).toContain("builtin-2026-09-04-4");
    expect(v4).toContain("mediaSetRevisions");
    expect(v4).toContain("themeInstructions");
    expect(v4).not.toContain('"mediaSetIds"');
    expect(v4).not.toContain('"themeRevisionRefs"');
    for (const format of CONTENT_FORMATS) expect(v4).toContain(canonicalDigest(contentFormatDefinition(format)));
  });

  it("separates immutable policy evidence from its monotonic current pointer", () => {
    expect(policySupersession).toContain('DROP INDEX "content_model_policy_revisions_active_unique"');
    expect(policySupersession).toContain('CREATE TABLE "content_model_policy_currents"');
    expect(policySupersession).toContain('CREATE TABLE "content_model_policy_supersessions"');
    expect(policySupersession).toContain("content model policy supersession must advance monotonically");
    expect(policySupersession).toContain("content_model_policy_supersessions_immutable");
  });

  it("persists immutable licensed theme and Blitz similarity evidence", () => {
    for (const value of [
      'CREATE TABLE "content_themes"',
      'CREATE TABLE "content_theme_revisions"',
      'CREATE TABLE "blitz_similarity_evidence"',
      "content_theme_revisions_immutable",
      "blitz_similarity_evidence_immutable",
      "blitz_similarity_evidence_candidate_unique",
      "license_evidence_ids",
    ]) expect(migration).toContain(value);
  });
});
