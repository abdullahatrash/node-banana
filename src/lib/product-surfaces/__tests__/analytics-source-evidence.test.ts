import { describe, expect, it } from "vitest"
import { buildSourceRevisionEvidence } from "../analytics"

const scope = { region: "mena", consentRevision: "consent-1", retentionUntil: "2026-12-01T00:00:00.000Z", campaignTag: "launch", contentType: "landing_page", platform: "website", publishingState: "not_applicable" } as const
const row = (sourceId: string, sourceRevision: number, metric: string, value: number, day: number) => ({ sourceId, sourceRevision, metric, value, occurredAt: new Date(`2026-09-0${day}T10:00:00Z`), capturedAt: new Date(`2026-09-0${day}T10:05:00Z`), scope })

describe("Analytics source-revision evidence", () => {
  it("keeps current and historical revisions explicit while reconciling every signed observation", () => {
    const rows = [row("website", 1, "websiteViews", 1, 1), row("website", 1, "websiteViews", 1, 2), row("website", 2, "websiteViews", 1, 3), row("retired", 4, "geoCitations", 1, 4)]
    const evidence = buildSourceRevisionEvidence(rows, new Map([["website", 2]]))
    expect(evidence).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceId: "website", sourceRevision: 2, classification: "current", eventCount: 1, metricTotals: { websiteViews: 1 } }),
      expect.objectContaining({ sourceId: "website", sourceRevision: 1, classification: "historical", eventCount: 2, metricTotals: { websiteViews: 2 } }),
      expect.objectContaining({ sourceId: "retired", sourceRevision: 4, classification: "historical", eventCount: 1, metricTotals: { geoCitations: 1 } }),
    ]))
    expect(evidence.reduce((sum, revision) => sum + revision.eventCount, 0)).toBe(rows.length)
    expect(evidence.reduce((sum, revision) => sum + Object.values(revision.metricTotals).reduce((subtotal, value) => subtotal + value, 0), 0)).toBe(rows.reduce((sum, item) => sum + item.value, 0))
  })
})
