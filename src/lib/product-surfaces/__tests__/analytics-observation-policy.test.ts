import { describe, expect, it } from "vitest"
import { admitGeoObservation, admitWebsiteObservation, AnalyticsObservationError, signAnalyticsReceipt, type VerifiedAnalyticsSource } from "../analytics-observation-policy"

const now = new Date("2026-09-04T12:34:56.000Z")
const credential = "collector_secret_123456789012345678901234567890"
const websiteSource: VerifiedAnalyticsSource = { workspaceId: "ws_1", sourceId: "website_1", revision: 3, kind: "website_analytics_source", hostname: "example.com", enabled: true, verificationStatus: "verified" }
const scope = { region: "mena" as const, consentRevision: "consent-v3", consentPurpose: "analytics" as const, retentionUntil: "2026-10-04T00:00:00.000Z", campaignTag: "launch-2026", contentType: "landing_page" as const, platform: "website" as const, accountRefDigest: null, publishingState: "not_applicable" as const }

function websiteInput(overrides: Record<string, unknown> = {}) {
  const payload = { eventId: "event.website.0001", eventType: "page_view" as const, occurredAt: "2026-09-04T12:30:00.000Z", scope, ...overrides }
  return { ...payload, signature: signAnalyticsReceipt(payload, credential) }
}

describe("analytics event receipt admission", () => {
  it("computes one observation, capture window, and digests server-side", () => {
    const admitted = admitWebsiteObservation(websiteInput(), { source: websiteSource, origin: "https://EXAMPLE.com", credential, now })
    expect(admitted).toMatchObject({ workspaceId: "ws_1", sourceId: "website_1", sourceRevision: 3, eventId: "event.website.0001", metric: "websiteViews", value: 1, idempotencyKey: "event:event.website.0001", windowStartedAt: new Date("2026-09-04T12:00:00.000Z"), windowEndedAt: new Date("2026-09-04T13:00:00.000Z"), capturedAt: now, scope })
    expect(admitted.credentialDigest).toMatch(/^sha256:[a-f0-9]{64}$/)
    expect(admitted.requestDigest).toMatch(/^sha256:[a-f0-9]{64}$/)
  })

  it.each([null, "http://example.com", "https://example.com:444", "https://example.com/path", "https://evil.example"])("rejects absent or non-exact origins: %s", (origin) => {
    expect(() => admitWebsiteObservation(websiteInput(), { source: websiteSource, origin, credential, now })).toThrowError(expect.objectContaining({ code: "ANALYTICS_SOURCE_ORIGIN_MISMATCH" }))
  })

  it("rejects aggregate fields, free-form paths, and forged signatures", () => {
    expect(() => admitWebsiteObservation({ ...websiteInput(), value: 12 }, { source: websiteSource, origin: "https://example.com", credential, now })).toThrowError(AnalyticsObservationError)
    expect(() => admitWebsiteObservation({ ...websiteInput(), path: "/customer/42" }, { source: websiteSource, origin: "https://example.com", credential, now })).toThrowError(AnalyticsObservationError)
    expect(() => admitWebsiteObservation({ ...websiteInput(), signature: `hmac-sha256:${"0".repeat(64)}` }, { source: websiteSource, origin: "https://example.com", credential, now })).toThrowError(expect.objectContaining({ code: "ANALYTICS_RECEIPT_SIGNATURE_INVALID" }))
  })

  it("fails closed for disabled, unverified, and cross-kind sources", () => {
    for (const source of [{ ...websiteSource, enabled: false }, { ...websiteSource, verificationStatus: "pending" as const }, { ...websiteSource, kind: "geo_analytics_source" as const }]) expect(() => admitWebsiteObservation(websiteInput(), { source, origin: "https://example.com", credential, now })).toThrowError(expect.objectContaining({ code: "ANALYTICS_SOURCE_NOT_VERIFIED" }))
  })

  it("binds GEO evidence to the exact source revision and server credential", () => {
    const source = { ...websiteSource, sourceId: "geo_1", kind: "geo_analytics_source" as const }
    const payload = { sourceId: "geo_1", sourceRevision: 3, eventId: "event.geo.0001", eventType: "citation_observed" as const, occurredAt: "2026-09-04T12:30:00.000Z", topicDigest: `sha256:${"a".repeat(64)}`, evidenceDigest: `sha256:${"b".repeat(64)}`, scope: { ...scope, platform: "chatgpt" as const, contentType: "article" as const } }
    const input = { ...payload, signature: signAnalyticsReceipt(payload, credential) }
    expect(admitGeoObservation(input, { source, credential, now })).toMatchObject({ sourceId: "geo_1", sourceRevision: 3, value: 1, evidenceDigest: payload.evidenceDigest })
    expect(() => admitGeoObservation({ ...input, sourceRevision: 2 }, { source, credential, now })).toThrowError(expect.objectContaining({ code: "ANALYTICS_SOURCE_REVISION_MISMATCH" }))
  })

  it("rejects stale, future, and expired-consent receipts", () => {
    expect(() => admitWebsiteObservation(websiteInput({ occurredAt: "2026-09-04T13:00:00.000Z" }), { source: websiteSource, origin: "https://example.com", credential, now })).toThrowError(expect.objectContaining({ code: "ANALYTICS_OBSERVATION_IN_FUTURE" }))
    expect(() => admitWebsiteObservation(websiteInput({ occurredAt: "2026-08-01T00:00:00.000Z" }), { source: websiteSource, origin: "https://example.com", credential, now })).toThrowError(expect.objectContaining({ code: "ANALYTICS_OBSERVATION_EXPIRED" }))
    expect(() => admitWebsiteObservation(websiteInput({ scope: { ...scope, retentionUntil: "2026-09-04T12:00:00.000Z" } }), { source: websiteSource, origin: "https://example.com", credential, now })).toThrowError(expect.objectContaining({ code: "ANALYTICS_OBSERVATION_EXPIRED" }))
  })
})
