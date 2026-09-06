import { describe, expect, it } from "vitest"
import { AnalyticsObservationError, signAnalyticsReceipt, type AnalyticsObservation, type VerifiedAnalyticsSource } from "../analytics-observation-policy"
import { AnalyticsObservationService, type AnalyticsObservationRepository, type StoredAnalyticsObservation } from "../analytics-observation-service"

const credential = "collector_secret_123456789012345678901234567890"
const source: VerifiedAnalyticsSource = { workspaceId: "ws_1", sourceId: "web_1", revision: 2, kind: "website_analytics_source", hostname: "example.com", enabled: true, verificationStatus: "verified" }
const scope = { region: "mena" as const, consentRevision: "consent-v2", consentPurpose: "analytics" as const, retentionUntil: "2026-10-04T00:00:00.000Z", campaignTag: null, contentType: "page" as const, platform: "website" as const, accountRefDigest: null, publishingState: "not_applicable" as const }
const payload = { eventId: "event.website.0001", eventType: "page_view" as const, occurredAt: "2026-09-04T11:00:00.000Z", scope }
const input = { ...payload, signature: signAnalyticsReceipt(payload, credential) }

class MemoryRepository implements AnalyticsObservationRepository {
  observations = new Map<string, StoredAnalyticsObservation>()
  websiteSource: VerifiedAnalyticsSource | null = source
  geoSource: VerifiedAnalyticsSource | null = { ...source, sourceId: "geo_1", kind: "geo_analytics_source" }
  async findWebsiteSourceByKey(key: string) { return key === credential ? this.websiteSource : null }
  async findGeoSource(workspaceId: string, sourceId: string) { return workspaceId === "ws_1" && sourceId === "geo_1" ? this.geoSource : null }
  async appendObservation(observation: AnalyticsObservation) {
    const key = `${observation.workspaceId}:${observation.sourceId}:${observation.eventId}`
    const existing = this.observations.get(key)
    if (existing) {
      if (existing.requestDigest !== observation.requestDigest) throw new AnalyticsObservationError("ANALYTICS_OBSERVATION_INVALID")
      return { created: false, observation: existing }
    }
    const stored = { ...observation, id: `observation_${this.observations.size + 1}`, createdAt: new Date("2026-09-04T12:00:00.000Z") }
    this.observations.set(key, stored)
    return { created: true, observation: stored }
  }
}

describe("AnalyticsObservationService", () => {
  it("resolves the credential server-side and stores one replay-safe event", async () => {
    const repository = new MemoryRepository()
    const service = new AnalyticsObservationService(repository, () => new Date("2026-09-04T12:00:00.000Z"))
    await expect(service.collectWebsite(input, { origin: "https://example.com", sourceKey: credential })).resolves.toMatchObject({ created: true, observation: { workspaceId: "ws_1", sourceId: "web_1", value: 1 } })
    await expect(service.collectWebsite(input, { origin: "https://example.com", sourceKey: credential })).resolves.toMatchObject({ created: false })
    expect(repository.observations).toHaveLength(1)
  })

  it("fails closed without a server-resolved source and never trusts caller workspace identity", async () => {
    const repository = new MemoryRepository(); repository.websiteSource = null
    const service = new AnalyticsObservationService(repository)
    await expect(service.collectWebsite(input, { origin: "https://example.com", sourceKey: credential })).rejects.toMatchObject({ code: "ANALYTICS_SOURCE_NOT_VERIFIED" })
    await expect(service.collectGeo("ws_other", { sourceId: "geo_1" }, credential)).rejects.toMatchObject({ code: "ANALYTICS_SOURCE_NOT_VERIFIED" })
  })

  it("rejects a stable event identity replay with different signed bytes", async () => {
    const repository = new MemoryRepository()
    const service = new AnalyticsObservationService(repository, () => new Date("2026-09-04T12:00:00.000Z"))
    await service.collectWebsite(input, { origin: "https://example.com", sourceKey: credential })
    const changedPayload = { ...payload, occurredAt: "2026-09-04T11:01:00.000Z" }
    await expect(service.collectWebsite({ ...changedPayload, signature: signAnalyticsReceipt(changedPayload, credential) }, { origin: "https://example.com", sourceKey: credential })).rejects.toMatchObject({ code: "ANALYTICS_OBSERVATION_INVALID" })
  })

  it("binds internal GEO collection to an authenticated workspace, source revision, evidence, and worker credential", async () => {
    const repository = new MemoryRepository()
    const service = new AnalyticsObservationService(repository, () => new Date("2026-09-04T12:00:00.000Z"))
    const geoPayload = { sourceId: "geo_1", sourceRevision: 2, eventId: "event.geo.0001", eventType: "citation_observed" as const, occurredAt: "2026-09-04T11:00:00.000Z", topicDigest: `sha256:${"c".repeat(64)}`, evidenceDigest: `sha256:${"d".repeat(64)}`, scope: { ...scope, platform: "chatgpt" as const, contentType: "article" as const } }
    const geo = { ...geoPayload, signature: signAnalyticsReceipt(geoPayload, credential) }
    await expect(service.collectGeo("ws_1", geo, credential)).resolves.toMatchObject({ created: true, observation: { sourceKind: "geo_analytics_source", value: 1, evidenceDigest: geo.evidenceDigest } })
  })
})
