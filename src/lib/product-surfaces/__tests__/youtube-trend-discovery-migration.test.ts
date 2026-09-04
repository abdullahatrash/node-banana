import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync("drizzle/0123_youtube_trend_discovery.sql", "utf8");

describe("YouTube trend discovery schema", () => {
  it("uses a separate mutable projection with provider order and bounded retention", () => {
    expect(migration).toContain('CREATE TABLE "youtube_trend_discovery_sources"');
    expect(migration).toContain('CREATE TABLE "youtube_trend_discovery_entries"');
    expect(migration).toContain('CREATE TABLE "youtube_trend_discovery_jobs"');
    expect(migration).toContain('"expires_at" <= "observed_at" + interval \'30 days\'');
    expect(migration).toContain('"source_url" = \'https://www.youtube.com/watch?v=\' || "video_id"');
    expect(migration).toContain("youtube_trend_discovery_jobs_active_source_unique");
    expect(migration).not.toContain("inspiration_trend_feed_entries");
    expect(migration).not.toContain("workspace_product_record");
    expect(migration).not.toMatch(/score|brand_profile|eligible_for_blitz/i);
  });
});
