import { randomUUID } from "node:crypto"
import { and, asc, eq, gte, sql } from "drizzle-orm"
import { getDb } from "@/lib/db"
import { productAnalyticsObservations, workspaceProductRecords } from "@/lib/db/schema"
import { geoAnalyticsSourceSchema, websiteAnalyticsSourceSchema } from "./definitions"
import { AnalyticsObservationError, type AnalyticsObservation, type VerifiedAnalyticsSource } from "./analytics-observation-policy"
import type { AnalyticsObservationRepository, StoredAnalyticsObservation } from "./analytics-observation-service"

export class PostgresAnalyticsObservationRepository implements AnalyticsObservationRepository {
  async hasVerifiedWebsiteOrigin(origin: string) {
    let hostname: string
    try { const url = new URL(origin); if (url.protocol !== "https:" || url.port || url.pathname !== "/" || url.search || url.hash || url.username || url.password) return false; hostname = url.hostname.toLowerCase().replace(/\.$/, "") } catch { return false }
    const [row] = await getDb().select({ id: workspaceProductRecords.id }).from(workspaceProductRecords).where(and(eq(workspaceProductRecords.kind, "website_analytics_source"), eq(workspaceProductRecords.state, "active"), sql`lower(${workspaceProductRecords.payload}->>'hostname') = ${hostname}`, sql`${workspaceProductRecords.payload}->>'verificationStatus' = 'verified'`, sql`${workspaceProductRecords.payload}->>'enabled' = 'true'`)).limit(1)
    return Boolean(row)
  }

  async findWebsiteSourceByKey(sourceKey: string) {
    const [row] = await getDb().select().from(workspaceProductRecords).where(and(eq(workspaceProductRecords.kind, "website_analytics_source"), eq(workspaceProductRecords.state, "active"), sql`${workspaceProductRecords.payload}->>'publicKey' = ${sourceKey}`)).limit(1)
    if (!row) return null
    const payload = websiteAnalyticsSourceSchema.safeParse(row.payload)
    if (!payload.success) return null
    return { workspaceId: row.workspaceId, sourceId: row.id, revision: row.revision, kind: "website_analytics_source" as const, hostname: payload.data.hostname, enabled: payload.data.enabled, verificationStatus: payload.data.verificationStatus }
  }

  async findGeoSource(workspaceId: string, sourceId: string) {
    const [row] = await getDb().select().from(workspaceProductRecords).where(and(eq(workspaceProductRecords.workspaceId, workspaceId), eq(workspaceProductRecords.id, sourceId), eq(workspaceProductRecords.kind, "geo_analytics_source"), eq(workspaceProductRecords.state, "active"))).limit(1)
    if (!row) return null
    const payload = geoAnalyticsSourceSchema.safeParse(row.payload)
    if (!payload.success) return null
    return { workspaceId: row.workspaceId, sourceId: row.id, revision: row.revision, kind: "geo_analytics_source" as const, hostname: payload.data.domain, enabled: payload.data.enabled, verificationStatus: payload.data.verificationStatus }
  }

  async appendObservation(observation: AnalyticsObservation) {
    const db = getDb()
    return db.transaction(async (tx) => {
      const [inserted] = await tx.insert(productAnalyticsObservations).values({ id: randomUUID(), ...observation, createdAt: new Date() }).onConflictDoNothing({ target: [productAnalyticsObservations.workspaceId, productAnalyticsObservations.sourceId, productAnalyticsObservations.idempotencyKey] }).returning()
      if (inserted) return { created: true, observation: stored(inserted) }
      const [existing] = await tx.select().from(productAnalyticsObservations).where(and(eq(productAnalyticsObservations.workspaceId, observation.workspaceId), eq(productAnalyticsObservations.sourceId, observation.sourceId), eq(productAnalyticsObservations.idempotencyKey, observation.idempotencyKey))).limit(1)
      if (!existing || existing.requestDigest !== observation.requestDigest) throw new AnalyticsObservationError("ANALYTICS_OBSERVATION_INVALID")
      return { created: false, observation: stored(existing) }
    })
  }
}

export async function listAnalyticsObservations(input: { workspaceId: string; from: Date }) {
  return getDb().select().from(productAnalyticsObservations).where(and(eq(productAnalyticsObservations.workspaceId, input.workspaceId), gte(productAnalyticsObservations.windowEndedAt, input.from))).orderBy(asc(productAnalyticsObservations.windowEndedAt), asc(productAnalyticsObservations.id))
}

function stored(row: typeof productAnalyticsObservations.$inferSelect): StoredAnalyticsObservation {
  return { ...row, sourceKind: row.sourceKind as VerifiedAnalyticsSource["kind"], metric: row.metric as AnalyticsObservation["metric"], evidenceDigest: row.evidenceDigest as `sha256:${string}`, requestDigest: row.requestDigest as `sha256:${string}` }
}

export const PRODUCTION_ANALYTICS_OBSERVATIONS = new PostgresAnalyticsObservationRepository()
