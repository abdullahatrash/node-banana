import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("licensed trend provider inbox migration", () => {
  it("persists immutable signed events, ordered cursors, leases, and explicit operator skips", () => {
    const migration = readFileSync("drizzle/0145_licensed_trend_provider_inbox.sql", "utf8");
    for (const value of [
      "licensed_trend_provider_cursors",
      "last_sequence",
      "licensed_trend_provider_events",
      "event_digest",
      "key_id",
      "sequence_unique",
      "queued",
      "claimed",
      "outcome_unknown",
      "skipped",
      "operator_note",
      "protect_licensed_trend_provider_event_identity",
      "LICENSED_TREND_PROVIDER_EVENT_IMMUTABLE",
    ]) expect(migration).toContain(value);
    expect(migration).toContain("UNIQUE(\"provider_key\", \"sequence\")");
    expect(migration).not.toMatch(/\bDROP\s+(TABLE|COLUMN)\b|\bTRUNCATE\b/i);
  });

  it("claims only the exact sequence after the durable provider cursor", () => {
    const source = readFileSync("src/lib/product-surfaces/licensed-trend-provider-inbox.ts", "utf8");
    expect(source).toContain("licensedTrendProviderCursors.lastSequence} + 1");
    expect(source).toContain("for(\"update\", { skipLocked: true })");
    expect(source).toContain("LICENSED_TREND_PROVIDER_EVENT_NOT_NEXT");
  });
});
