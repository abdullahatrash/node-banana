import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

describe("analytics observation persistence contract", () => {
  it("pins signed, replay-safe events to an exact source revision and makes observations append-only", () => {
    const migration = readFileSync("drizzle/0098_analytics_event_receipts_refresh_outbox.sql", "utf8")
    expect(migration).toContain('REFERENCES "workspace_product_record_revisions"("workspace_id", "record_id", "revision") ON DELETE RESTRICT')
    expect(migration).toContain('product_analytics_observations_event_unique')
    expect(migration).toContain('"event_type" = \'page_view\'')
    expect(migration).toContain('"event_id" NOT LIKE \'legacy:%\' AND "value" = 1')
    expect(migration).toContain('product_analytics_observations_append_only')
    expect(migration).toContain('BEFORE UPDATE OR DELETE')
    expect(migration).toContain('"receipt_signature" ~ \'^hmac-sha256:[a-f0-9]{64}$\'')
    expect(migration).toContain('"scope"->>\'consentPurpose\' = \'analytics\'')
    expect(migration).toContain("^sha256:[a-f0-9]{64}$")
  })

  it("creates a recoverable, source-revision-bound leased refresh outbox", () => {
    const migration = readFileSync("drizzle/0098_analytics_event_receipts_refresh_outbox.sql", "utf8")
    expect(migration).toContain('CREATE TABLE "product_analytics_refresh_jobs"')
    expect(migration).toContain('product_analytics_refresh_jobs_source_revision_fk')
    expect(migration).toContain("'queued','claimed','running','succeeded','failed_known','outcome_unknown'")
    expect(migration).toContain('"lease_owner" IS NOT NULL AND "lease_expires_at" IS NOT NULL')
    expect(migration).toContain('product_analytics_refresh_jobs_command_unique')
  })
})
