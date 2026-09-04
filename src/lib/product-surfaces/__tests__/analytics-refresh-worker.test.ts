import { describe, expect, it, vi } from "vitest"
import { AnalyticsRefreshWorker, type AnalyticsRefreshJob, type AnalyticsRefreshRepository } from "../analytics-refresh-worker"

const now = new Date("2026-09-04T12:00:00.000Z")
const job: AnalyticsRefreshJob = { workspaceId: "ws_1", id: "refresh_1", sourceId: "source_1", sourceRevision: 4, sourceKind: "website_analytics_source", state: "claimed", cursor: null, processedEvents: 0, attempt: 1, maxAttempts: 3, leaseOwner: "worker_1", leaseEpoch: 2, requestedAt: new Date("2026-09-04T11:00:00.000Z") }

function repository(overrides: Partial<AnalyticsRefreshRepository> = {}): AnalyticsRefreshRepository {
  return {
    claim: vi.fn(async () => job),
    start: vi.fn(async () => true),
    inspectEvidence: vi.fn(async () => ({ eventCount: 1, cursor: "event_1" })),
    checkpoint: vi.fn(async () => true),
    complete: vi.fn(async () => true),
    retry: vi.fn(async () => "queued" as const),
    ...overrides,
  }
}

describe("AnalyticsRefreshWorker", () => {
  it("leases, checkpoints exact source-revision evidence, and completes", async () => {
    const repo = repository({ claim: vi.fn().mockResolvedValueOnce(job).mockResolvedValueOnce(null) })
    const result = await new AnalyticsRefreshWorker(repo, () => now).run({ workerId: "worker_1" })
    expect(result).toEqual({ claimed: 1, succeeded: 1, retried: 0, failedKnown: 0, lostLease: 0 })
    expect(repo.inspectEvidence).toHaveBeenCalledWith({ job })
    expect(repo.checkpoint).toHaveBeenCalledWith(expect.objectContaining({ job, processedEvents: 1, cursor: "event_1" }))
    expect(repo.complete).toHaveBeenCalledWith({ job, at: now })
  })

  it("backs off without claiming false freshness when no signed receipt arrived", async () => {
    const repo = repository({ claim: vi.fn().mockResolvedValueOnce(job).mockResolvedValueOnce(null), inspectEvidence: vi.fn(async () => ({ eventCount: 0, cursor: null })) })
    const result = await new AnalyticsRefreshWorker(repo, () => now).run({ workerId: "worker_1" })
    expect(result.retried).toBe(1)
    expect(repo.complete).not.toHaveBeenCalled()
    expect(repo.retry).toHaveBeenCalledWith(expect.objectContaining({ errorCode: "ANALYTICS_REFRESH_AWAITING_SIGNED_RECEIPT" }))
  })

  it("stops a stale worker from committing after it loses the fenced lease", async () => {
    const repo = repository({ claim: vi.fn().mockResolvedValueOnce(job).mockResolvedValueOnce(null), checkpoint: vi.fn(async () => false) })
    const result = await new AnalyticsRefreshWorker(repo, () => now).run({ workerId: "worker_1" })
    expect(result.lostLease).toBe(1)
    expect(repo.complete).not.toHaveBeenCalled()
  })
})
