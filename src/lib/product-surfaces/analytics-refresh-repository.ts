import "server-only"

import { and, asc, count, desc, eq, gte, inArray, lt, lte, or, sql } from "drizzle-orm"
import { getDb } from "@/lib/db"
import { productAnalyticsObservations, productAnalyticsRefreshJobs } from "@/lib/db/schema"
import { AnalyticsRefreshWorker, type AnalyticsRefreshJob, type AnalyticsRefreshRepository } from "./analytics-refresh-worker"

export class PostgresAnalyticsRefreshRepository implements AnalyticsRefreshRepository {
  async claim(input: { workerId: string; at: Date; leaseExpiresAt: Date }) {
    return getDb().transaction(async (tx) => {
      await tx.update(productAnalyticsRefreshJobs).set({ state: "failed_known", leaseOwner: null, leaseExpiresAt: null, lastErrorCode: "ANALYTICS_REFRESH_LEASE_EXHAUSTED", finishedAt: input.at, updatedAt: input.at }).where(and(inArray(productAnalyticsRefreshJobs.state, ["claimed", "running"]), lte(productAnalyticsRefreshJobs.leaseExpiresAt, input.at), gte(productAnalyticsRefreshJobs.attempt, productAnalyticsRefreshJobs.maxAttempts)))
      const [due] = await tx.select().from(productAnalyticsRefreshJobs).where(or(
        and(eq(productAnalyticsRefreshJobs.state, "queued"), lte(productAnalyticsRefreshJobs.nextAttemptAt, input.at), lt(productAnalyticsRefreshJobs.attempt, productAnalyticsRefreshJobs.maxAttempts)),
        and(inArray(productAnalyticsRefreshJobs.state, ["claimed", "running"]), lte(productAnalyticsRefreshJobs.leaseExpiresAt, input.at), lt(productAnalyticsRefreshJobs.attempt, productAnalyticsRefreshJobs.maxAttempts)),
      )).orderBy(asc(productAnalyticsRefreshJobs.nextAttemptAt), asc(productAnalyticsRefreshJobs.id)).limit(1).for("update", { skipLocked: true })
      if (!due) return null
      const [claimed] = await tx.update(productAnalyticsRefreshJobs).set({ state: "claimed", leaseOwner: input.workerId, leaseEpoch: sql`${productAnalyticsRefreshJobs.leaseEpoch} + 1`, leaseExpiresAt: input.leaseExpiresAt, attempt: sql`${productAnalyticsRefreshJobs.attempt} + 1`, startedAt: due.startedAt ?? input.at, updatedAt: input.at }).where(and(eq(productAnalyticsRefreshJobs.workspaceId, due.workspaceId), eq(productAnalyticsRefreshJobs.id, due.id), eq(productAnalyticsRefreshJobs.leaseEpoch, due.leaseEpoch))).returning()
      return claimed ? jobFromRow(claimed) : null
    })
  }

  async start(input: { job: AnalyticsRefreshJob; at: Date; leaseExpiresAt: Date }) {
    const [row] = await getDb().update(productAnalyticsRefreshJobs).set({ state: "running", leaseExpiresAt: input.leaseExpiresAt, updatedAt: input.at }).where(owned(input.job, "claimed")).returning({ id: productAnalyticsRefreshJobs.id })
    return Boolean(row)
  }

  async inspectEvidence(input: { job: AnalyticsRefreshJob }) {
    const [aggregate, latest] = await Promise.all([
      getDb().select({ value: count() }).from(productAnalyticsObservations).where(and(eq(productAnalyticsObservations.workspaceId, input.job.workspaceId), eq(productAnalyticsObservations.sourceId, input.job.sourceId), eq(productAnalyticsObservations.sourceRevision, input.job.sourceRevision), gte(productAnalyticsObservations.capturedAt, input.job.requestedAt))),
      getDb().select({ eventId: productAnalyticsObservations.eventId }).from(productAnalyticsObservations).where(and(eq(productAnalyticsObservations.workspaceId, input.job.workspaceId), eq(productAnalyticsObservations.sourceId, input.job.sourceId), eq(productAnalyticsObservations.sourceRevision, input.job.sourceRevision), gte(productAnalyticsObservations.capturedAt, input.job.requestedAt))).orderBy(desc(productAnalyticsObservations.capturedAt), desc(productAnalyticsObservations.id)).limit(1),
    ])
    return { eventCount: aggregate[0]?.value ?? 0, cursor: latest[0]?.eventId ?? null }
  }

  async checkpoint(input: { job: AnalyticsRefreshJob; processedEvents: number; cursor: string | null; at: Date; leaseExpiresAt: Date }) {
    const [row] = await getDb().update(productAnalyticsRefreshJobs).set({ cursor: input.cursor, processedEvents: input.processedEvents, leaseExpiresAt: input.leaseExpiresAt, updatedAt: input.at }).where(owned(input.job, "running")).returning({ id: productAnalyticsRefreshJobs.id })
    return Boolean(row)
  }

  async complete(input: { job: AnalyticsRefreshJob; at: Date }) {
    const [row] = await getDb().update(productAnalyticsRefreshJobs).set({ state: "succeeded", leaseOwner: null, leaseExpiresAt: null, lastErrorCode: null, finishedAt: input.at, updatedAt: input.at }).where(owned(input.job, "running")).returning({ id: productAnalyticsRefreshJobs.id })
    return Boolean(row)
  }

  async retry(input: { job: AnalyticsRefreshJob; errorCode: string; at: Date; nextAttemptAt: Date }) {
    const terminal = input.job.attempt >= input.job.maxAttempts
    const [row] = await getDb().update(productAnalyticsRefreshJobs).set({ state: terminal ? "failed_known" : "queued", leaseOwner: null, leaseExpiresAt: null, lastErrorCode: input.errorCode, nextAttemptAt: input.nextAttemptAt, finishedAt: terminal ? input.at : null, updatedAt: input.at }).where(and(ownedIdentity(input.job), inArray(productAnalyticsRefreshJobs.state, ["claimed", "running"]))).returning({ id: productAnalyticsRefreshJobs.id })
    return row ? terminal ? "failed_known" as const : "queued" as const : "lost_lease" as const
  }
}

function owned(job: AnalyticsRefreshJob, state: "claimed" | "running") { return and(ownedIdentity(job), eq(productAnalyticsRefreshJobs.state, state)) }
function ownedIdentity(job: AnalyticsRefreshJob) { return and(eq(productAnalyticsRefreshJobs.workspaceId, job.workspaceId), eq(productAnalyticsRefreshJobs.id, job.id), eq(productAnalyticsRefreshJobs.leaseOwner, job.leaseOwner), eq(productAnalyticsRefreshJobs.leaseEpoch, job.leaseEpoch)) }
function jobFromRow(row: typeof productAnalyticsRefreshJobs.$inferSelect): AnalyticsRefreshJob { return { workspaceId: row.workspaceId, id: row.id, sourceId: row.sourceId, sourceRevision: row.sourceRevision, sourceKind: row.sourceKind as AnalyticsRefreshJob["sourceKind"], state: row.state as AnalyticsRefreshJob["state"], cursor: row.cursor, processedEvents: row.processedEvents, attempt: row.attempt, maxAttempts: row.maxAttempts, leaseOwner: row.leaseOwner!, leaseEpoch: row.leaseEpoch, requestedAt: row.requestedAt } }

export const PRODUCTION_ANALYTICS_REFRESH_WORKER = new AnalyticsRefreshWorker(new PostgresAnalyticsRefreshRepository())
