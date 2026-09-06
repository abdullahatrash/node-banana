import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync("drizzle/0117_inspiration_trend_ingestion.sql", "utf8");
const journal = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8")) as { entries: Array<{ idx: number; tag: string }> };

describe("inspiration trend ingestion migration", () => {
  it("installs durable, Workspace-scoped source, job, feed, and immutable receipt storage", () => {
    for (const table of ["inspiration_trend_sources", "inspiration_trend_ingestion_jobs", "inspiration_trend_feed_entries", "inspiration_trend_ingestion_receipts"]) {
      expect(sql).toContain(`CREATE TABLE "${table}"`);
    }
    expect(sql).toContain('CONSTRAINT "inspiration_trend_ingestion_jobs_source_key_unique" UNIQUE ("workspace_id","source_id","source_key")');
    expect(sql).toContain('"ranking_context" jsonb NOT NULL');
    expect(sql).not.toContain("inspiration_trend_sources_adapter_unique");
    expect(sql).toContain('CONSTRAINT "inspiration_trend_ingestion_receipts_pk" PRIMARY KEY ("workspace_id","source_id","external_item_id","observation_digest","ranking_digest")');
    expect(sql).toContain('CREATE TRIGGER "inspiration_trend_ingestion_receipts_append_only" BEFORE UPDATE OR DELETE');
    expect(sql).toContain('"rights_status" IN (\'licensed\',\'user_submitted\',\'embeddable\',\'metadata_only\',\'restricted\')');
  });

  it("registers 0117 after the commercial catalog migration", () => {
    const entry = journal.entries.find((item) => item.idx === 117);
    expect(entry).toEqual(expect.objectContaining({ idx: 117, tag: "0117_inspiration_trend_ingestion" }));
    expect(journal.entries.findIndex((item) => item.idx === 117)).toBeGreaterThan(journal.entries.findIndex((item) => item.idx === 116));
  });
});
