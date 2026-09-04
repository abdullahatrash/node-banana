import { admitGeoObservation, admitWebsiteObservation, AnalyticsObservationError, type AnalyticsObservation, type VerifiedAnalyticsSource } from "./analytics-observation-policy"

export type StoredAnalyticsObservation = AnalyticsObservation & { id: string; createdAt: Date }

export interface AnalyticsObservationRepository {
  findWebsiteSourceByKey(sourceKey: string): Promise<VerifiedAnalyticsSource | null>
  findGeoSource(workspaceId: string, sourceId: string): Promise<VerifiedAnalyticsSource | null>
  appendObservation(observation: AnalyticsObservation): Promise<{ created: boolean; observation: StoredAnalyticsObservation }>
}

export class AnalyticsObservationService {
  constructor(private readonly repository: AnalyticsObservationRepository, private readonly now: () => Date = () => new Date()) {}

  async collectWebsite(input: unknown, origin: string | null) {
    const sourceKey = readSourceKey(input)
    const source = sourceKey ? await this.repository.findWebsiteSourceByKey(sourceKey) : null
    if (!source) throw new AnalyticsObservationError("ANALYTICS_SOURCE_NOT_VERIFIED")
    return this.repository.appendObservation(admitWebsiteObservation(input, { source, origin, now: this.now() }))
  }

  async collectGeo(workspaceId: string, input: unknown) {
    const sourceId = readSourceId(input)
    const source = sourceId ? await this.repository.findGeoSource(workspaceId, sourceId) : null
    if (!source || source.workspaceId !== workspaceId) throw new AnalyticsObservationError("ANALYTICS_SOURCE_NOT_VERIFIED")
    return this.repository.appendObservation(admitGeoObservation(input, { source, now: this.now() }))
  }
}

function readSourceKey(input: unknown) {
  if (!input || typeof input !== "object" || !("sourceKey" in input) || typeof input.sourceKey !== "string") return null
  return input.sourceKey
}

function readSourceId(input: unknown) {
  if (!input || typeof input !== "object" || !("sourceId" in input) || typeof input.sourceId !== "string") return null
  return input.sourceId
}
