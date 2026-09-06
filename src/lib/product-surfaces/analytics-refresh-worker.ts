import "server-only"

export type AnalyticsRefreshJob = {
  workspaceId: string
  id: string
  sourceId: string
  sourceRevision: number
  sourceKind: "website_analytics_source" | "geo_analytics_source"
  state: "claimed" | "running"
  cursor: string | null
  processedEvents: number
  attempt: number
  maxAttempts: number
  leaseOwner: string
  leaseEpoch: number
  requestedAt: Date
}

export interface AnalyticsRefreshRepository {
  claim(input: { workerId: string; at: Date; leaseExpiresAt: Date }): Promise<AnalyticsRefreshJob | null>
  start(input: { job: AnalyticsRefreshJob; at: Date; leaseExpiresAt: Date }): Promise<boolean>
  inspectEvidence(input: { job: AnalyticsRefreshJob }): Promise<{ eventCount: number; cursor: string | null }>
  checkpoint(input: { job: AnalyticsRefreshJob; processedEvents: number; cursor: string | null; at: Date; leaseExpiresAt: Date }): Promise<boolean>
  complete(input: { job: AnalyticsRefreshJob; at: Date }): Promise<boolean>
  retry(input: { job: AnalyticsRefreshJob; errorCode: string; at: Date; nextAttemptAt: Date }): Promise<"queued" | "failed_known" | "lost_lease">
}

export class AnalyticsRefreshWorker {
  constructor(
    private readonly repository: AnalyticsRefreshRepository,
    private readonly now: () => Date = () => new Date(),
    private readonly leaseMilliseconds = 60_000,
  ) {}

  async run(input: { workerId: string; limit?: number }) {
    const summary = { claimed: 0, succeeded: 0, retried: 0, failedKnown: 0, lostLease: 0 }
    const limit = Math.max(1, Math.min(input.limit ?? 20, 100))
    for (let index = 0; index < limit; index += 1) {
      const claimedAt = this.now()
      const job = await this.repository.claim({ workerId: input.workerId, at: claimedAt, leaseExpiresAt: this.leaseAfter(claimedAt) })
      if (!job) break
      summary.claimed += 1
      try {
        const startedAt = this.now()
        if (!await this.repository.start({ job, at: startedAt, leaseExpiresAt: this.leaseAfter(startedAt) })) { summary.lostLease += 1; continue }
        const evidence = await this.repository.inspectEvidence({ job })
        if (evidence.eventCount > job.processedEvents) {
          const checkpointAt = this.now()
          if (!await this.repository.checkpoint({ job, processedEvents: evidence.eventCount, cursor: evidence.cursor, at: checkpointAt, leaseExpiresAt: this.leaseAfter(checkpointAt) })) { summary.lostLease += 1; continue }
          if (await this.repository.complete({ job, at: this.now() })) summary.succeeded += 1
          else summary.lostLease += 1
          continue
        }
        const state = await this.repository.retry({ job, errorCode: "ANALYTICS_REFRESH_AWAITING_SIGNED_RECEIPT", at: this.now(), nextAttemptAt: this.nextAttempt(job.attempt) })
        if (state === "queued") summary.retried += 1
        else if (state === "failed_known") summary.failedKnown += 1
        else summary.lostLease += 1
      } catch {
        const state = await this.repository.retry({ job, errorCode: "ANALYTICS_REFRESH_RECONCILE_FAILED", at: this.now(), nextAttemptAt: this.nextAttempt(job.attempt) })
        if (state === "queued") summary.retried += 1
        else if (state === "failed_known") summary.failedKnown += 1
        else summary.lostLease += 1
      }
    }
    return summary
  }

  private leaseAfter(at: Date) { return new Date(at.getTime() + this.leaseMilliseconds) }
  private nextAttempt(attempt: number) { return new Date(this.now().getTime() + Math.min(60 * 60_000, 30_000 * 2 ** Math.min(attempt, 7))) }
}
