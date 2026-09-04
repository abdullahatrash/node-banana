import { describe, expect, it } from "vitest"
import { admitGeoObservation, admitWebsiteObservation, AnalyticsObservationError, type VerifiedAnalyticsSource } from "../analytics-observation-policy"

const now = new Date("2026-09-04T12:00:00.000Z")
const websiteSource: VerifiedAnalyticsSource = { workspaceId: "ws_1", sourceId: "website_1", revision: 3, kind: "website_analytics_source", hostname: "example.com", enabled: true, verificationStatus: "verified" }
const websiteInput = { sourceKey: "web_1234567890123456789012345678", idempotencyKey: "page-views:2026-09-04T11", metric: "websiteViews", value: 12, window: { startedAt: "2026-09-04T11:00:00.000Z", endedAt: "2026-09-04T12:00:00.000Z" } }

describe("analytics observation admission", () => {
  it("binds website observations to the verified source and exact HTTPS origin", () => {
    expect(admitWebsiteObservation(websiteInput, { source: websiteSource, origin: "https://EXAMPLE.com", now })).toMatchObject({ workspaceId: "ws_1", sourceId: "website_1", sourceRevision: 3, metric: "websiteViews", value: 12 })
  })

  it.each([null, "http://example.com", "https://example.com:444", "https://example.com/path", "https://evil.example"])("rejects absent or non-exact origins: %s", (origin) => {
    expect(() => admitWebsiteObservation(websiteInput, { source: websiteSource, origin, now })).toThrowError(expect.objectContaining({ code: "ANALYTICS_SOURCE_ORIGIN_MISMATCH" }))
  })

  it("fails closed for disabled, unverified, and cross-kind sources", () => {
    for (const source of [{ ...websiteSource, enabled: false }, { ...websiteSource, verificationStatus: "pending" as const }, { ...websiteSource, kind: "geo_analytics_source" as const }]) {
      expect(() => admitWebsiteObservation(websiteInput, { source, origin: "https://example.com", now })).toThrowError(expect.objectContaining({ code: "ANALYTICS_SOURCE_NOT_VERIFIED" }))
    }
  })

  it("rejects privacy-unsafe free-form fields and invalid windows", () => {
    expect(() => admitWebsiteObservation({ ...websiteInput, url: "https://example.com/customer/42" }, { source: websiteSource, origin: "https://example.com", now })).toThrowError(AnalyticsObservationError)
    expect(() => admitWebsiteObservation({ ...websiteInput, window: { startedAt: websiteInput.window.endedAt, endedAt: websiteInput.window.startedAt } }, { source: websiteSource, origin: "https://example.com", now })).toThrowError(AnalyticsObservationError)
  })

  it("requires GEO evidence and the exact verified source revision", () => {
    const source = { ...websiteSource, sourceId: "geo_1", kind: "geo_analytics_source" as const }
    const input = { sourceId: "geo_1", sourceRevision: 3, idempotencyKey: "geo:2026-09-04", metric: "geoCitations", value: 4, window: websiteInput.window, evidenceDigest: `sha256:${"a".repeat(64)}` }
    expect(admitGeoObservation(input, { source, now })).toMatchObject({ sourceId: "geo_1", sourceRevision: 3, evidenceDigest: input.evidenceDigest })
    expect(() => admitGeoObservation({ ...input, sourceRevision: 2 }, { source, now })).toThrowError(expect.objectContaining({ code: "ANALYTICS_SOURCE_REVISION_MISMATCH" }))
  })

  it("rejects future-dated observations and produces deterministic request digests", () => {
    const first = admitWebsiteObservation(websiteInput, { source: websiteSource, origin: "https://example.com", now })
    const second = admitWebsiteObservation(websiteInput, { source: websiteSource, origin: "https://example.com", now })
    expect(first.requestDigest).toBe(second.requestDigest)
    expect(() => admitWebsiteObservation({ ...websiteInput, window: { ...websiteInput.window, endedAt: "2026-09-04T13:00:00.000Z" } }, { source: websiteSource, origin: "https://example.com", now })).toThrowError(expect.objectContaining({ code: "ANALYTICS_OBSERVATION_IN_FUTURE" }))
  })
})
