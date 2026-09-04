import { describe, expect, it } from "vitest"
import { AnalyticsObservationError, type AnalyticsObservation, type VerifiedAnalyticsSource } from "../analytics-observation-policy"
import { AnalyticsObservationService, type AnalyticsObservationRepository, type StoredAnalyticsObservation } from "../analytics-observation-service"

const source: VerifiedAnalyticsSource = { workspaceId: "ws_1", sourceId: "web_1", revision: 2, kind: "website_analytics_source", hostname: "example.com", enabled: true, verificationStatus: "verified" }
const input = { sourceKey: "web_1234567890123456789012345678", idempotencyKey: "views:2026-09-04", metric: "websiteViews", value: 8, window: { startedAt: "2026-09-04T10:00:00.000Z", endedAt: "2026-09-04T11:00:00.000Z" } }

class MemoryRepository implements AnalyticsObservationRepository {
  observations = new Map<string, StoredAnalyticsObservation>()
  websiteSource: VerifiedAnalyticsSource | null = source
  geoSource: VerifiedAnalyticsSource | null = { ...source, sourceId: "geo_1", kind: "geo_analytics_source" }
  async findWebsiteSourceByKey(key: string) { return key === input.sourceKey ? this.websiteSource : null }
  async findGeoSource(workspaceId: string, sourceId: string) { return workspaceId === "ws_1" && sourceId === "geo_1" ? this.geoSource : null }
  async appendObservation(observation: AnalyticsObservation) {
    const key = `${observation.workspaceId}:${observation.sourceId}:${observation.idempotencyKey}`
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
  it("resolves the opaque website key server-side and stores an idempotent observation", async () => {
    const repository = new MemoryRepository()
    const service = new AnalyticsObservationService(repository, () => new Date("2026-09-04T12:00:00.000Z"))
    await expect(service.collectWebsite(input, "https://example.com")).resolves.toMatchObject({ created: true, observation: { workspaceId: "ws_1", sourceId: "web_1", value: 8 } })
    await expect(service.collectWebsite(input, "https://example.com")).resolves.toMatchObject({ created: false })
    expect(repository.observations).toHaveLength(1)
  })

  it("fails closed without a server-resolved source and never trusts caller workspace identity", async () => {
    const repository = new MemoryRepository()
    repository.websiteSource = null
    const service = new AnalyticsObservationService(repository)
    await expect(service.collectWebsite(input, "https://example.com")).rejects.toMatchObject({ code: "ANALYTICS_SOURCE_NOT_VERIFIED" })
    await expect(service.collectGeo("ws_other", { sourceId: "geo_1" })).rejects.toMatchObject({ code: "ANALYTICS_SOURCE_NOT_VERIFIED" })
  })

  it("rejects reuse of an idempotency key with different metric bytes", async () => {
    const repository = new MemoryRepository()
    const service = new AnalyticsObservationService(repository, () => new Date("2026-09-04T12:00:00.000Z"))
    await service.collectWebsite(input, "https://example.com")
    await expect(service.collectWebsite({ ...input, value: 9 }, "https://example.com")).rejects.toMatchObject({ code: "ANALYTICS_OBSERVATION_INVALID" })
  })

  it("binds internal GEO collection to authenticated workspace, source revision, and evidence", async () => {
    const repository = new MemoryRepository()
    const service = new AnalyticsObservationService(repository, () => new Date("2026-09-04T12:00:00.000Z"))
    const geo = { sourceId: "geo_1", sourceRevision: 2, idempotencyKey: "geo:2026-09-04", metric: "geoCitations", value: 3, window: input.window, evidenceDigest: `sha256:${"c".repeat(64)}` }
    await expect(service.collectGeo("ws_1", geo)).resolves.toMatchObject({ created: true, observation: { sourceKind: "geo_analytics_source", evidenceDigest: geo.evidenceDigest } })
  })
})
