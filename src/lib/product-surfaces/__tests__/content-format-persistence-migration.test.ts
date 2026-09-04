import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CONTENT_FORMATS } from "../definitions";

const migration = readFileSync("drizzle/0100_content_format_definitions_and_similarity.sql", "utf8");

describe("Content format persistence migration", () => {
  it("seeds every observed format as an exact active revision", () => {
    for (const format of CONTENT_FORMATS) {
      expect(migration).toContain(`('${format}','sha256:`);
    }
    expect(migration).toContain("content_format_definition_revisions_one_active");
    expect(migration).toContain("content_format_definition_revisions_immutable");
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
