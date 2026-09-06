import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync("drizzle/0127_marketing_attribution.sql", "utf8");
const merchantOccurrenceMigration = readFileSync("drizzle/0128_merchant_event_occurred_at.sql", "utf8");

describe("marketing attribution migration", () => {
  it("creates separate consent, outbox, delivery evidence, and replay tables", () => {
    expect(migration).toContain('CREATE TABLE "marketing_attribution_consents"');
    expect(migration).toContain('CREATE TABLE "marketing_attribution_events"');
    expect(migration).toContain('CREATE TABLE "marketing_attribution_delivery_receipts"');
    expect(migration).toContain('CREATE TABLE "marketing_attribution_mutation_receipts"');
    expect(migration).toContain("marketing_attribution_events_consent_fk");
  });

  it("is additive and constrains purpose, provider, event names, and terminal outcomes", () => {
    expect(migration).not.toMatch(/\bDROP\b|\bTRUNCATE\b/i);
    expect(migration).toContain("'advertising_attribution'");
    expect(migration).toContain("'x_ads'");
    expect(migration).toContain("'sign_up','trial_started','purchase'");
    expect(migration).toContain("'outcome_unknown'");
  });

  it("retains the exact merchant occurrence time needed for deterministic recovery", () => {
    expect(merchantOccurrenceMigration).toContain('ADD COLUMN "provider_occurred_at" timestamp with time zone');
    expect(merchantOccurrenceMigration).toContain('ALTER COLUMN "provider_occurred_at" SET NOT NULL');
    expect(merchantOccurrenceMigration).not.toMatch(/\bDROP\b|\bTRUNCATE\b/i);
  });
});
