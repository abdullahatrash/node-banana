import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

describe("analytics observation persistence contract", () => {
  it("pins every immutable observation to an exact source revision and bounded metric contract", () => {
    const migration = readFileSync("drizzle/0095_product_analytics_observations.sql", "utf8")
    expect(migration).toContain('REFERENCES "workspace_product_record_revisions"("workspace_id", "record_id", "revision") ON DELETE RESTRICT')
    expect(migration).toContain('UNIQUE("workspace_id", "source_id", "idempotency_key")')
    expect(migration).toContain('"source_kind" = \'website_analytics_source\' AND "metric" = \'websiteViews\'')
    expect(migration).toContain('"window_ended_at" <= "window_started_at" + interval \'24 hours\'')
    expect(migration).toContain("^sha256:[a-f0-9]{64}$")
  })
})
