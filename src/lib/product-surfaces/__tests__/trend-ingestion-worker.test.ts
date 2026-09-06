import { describe, expect, it, vi } from "vitest";
import { TrendAdapterRegistry, TrendIngestionWorker, type ClaimedTrendIngestionJob, type TrendIngestionRepository } from "../trend-ingestion-worker";
import type { TrendIngestionCandidate } from "../trend-types";

const now = new Date("2026-09-04T12:00:00.000Z");
const candidate: TrendIngestionCandidate = {
  externalItemId: "trend-1", title: "Gulf commerce launch", sourceUrl: "https://example.com/trend-1", sourceName: "Licensed feed",
  sourcePublishedAt: "2026-09-04T09:00:00.000Z", sourceContentDigest: `sha256:${"a".repeat(64)}`,
  metricsObservedAt: "2026-09-04T11:00:00.000Z", metrics: { views: 50_000, likes: 4_000 }, region: "GCC",
  contentLanguage: "ar", arabicVariety: "gulf", format: "video_hook_demo", tags: ["commerce"], creativePrimitives: { topics: [], hookPattern: null, pacing: null, structure: [] },
  rights: { status: "metadata_only", evidenceRef: "official:terms", evidenceDigest: `sha256:${"b".repeat(64)}`, observedAt: "2026-09-04T11:00:00.000Z", expiresAt: null, sourceAssetId: null, sourceMediaType: null, rightsSnapshot: null, permittedInfluence: ["topic"] },
};
const job: ClaimedTrendIngestionJob = {
  workspaceId: "workspace-1", id: "job-1", sourceId: "source-1", sourceKind: "official_api", adapterKey: "official",
  cursor: null, sourceKey: "scheduled:2026-09-04T12:00:00.000Z", leaseOwner: "worker-1", leaseEpoch: 1, attempt: 0, maxAttempts: 5,
  rankingEvaluatedAt: now,
  rankingContext: { brandProfile: null, preferredRegions: ["GCC"], preferredArabicVarieties: ["gulf"], preferredFormats: ["video_hook_demo"], preferredTags: [], excludedTags: [] },
};

function repository(overrides: Partial<TrendIngestionRepository> = {}): TrendIngestionRepository {
  return {
    scheduleDue: vi.fn().mockResolvedValue(1),
    claim: vi.fn().mockResolvedValueOnce(job).mockResolvedValue(null),
    persistPage: vi.fn().mockResolvedValue({ inserted: 1, updated: 0, replayed: 0, restricted: 0 }),
    checkpoint: vi.fn().mockResolvedValue(true), complete: vi.fn().mockResolvedValue(true),
    retry: vi.fn().mockResolvedValue("queued"),
    ...overrides,
  };
}

describe("durable trend ingestion worker", () => {
  it("schedules due sources, validates the provider-neutral page, ranks it, and completes with a fenced lease", async () => {
    const repo = repository();
    const adapter = { key: "official", fetch: vi.fn().mockResolvedValue({ items: [candidate], nextCursor: "cursor-2", hasMore: false }) };
    const result = await new TrendIngestionWorker(repo, new TrendAdapterRegistry([adapter]), () => now).run({ workerId: "worker-1", limit: 5 });

    expect(result).toEqual({ scheduled: 1, claimed: 1, succeeded: 1, checkpointed: 0, retried: 0, failedKnown: 0, lostLease: 0, ingested: 1, updated: 0, replayed: 0, restricted: 0 });
    expect(adapter.fetch).toHaveBeenCalledWith({ workspaceId: "workspace-1", sourceId: "source-1", cursor: null, limit: 100, requestedAt: now });
    expect(repo.persistPage).toHaveBeenCalledWith(expect.objectContaining({ job, items: [expect.objectContaining({ candidate, ranking: expect.objectContaining({ digest: expect.stringMatching(/^sha256:/), eligibleForBlitz: false }) })] }));
    expect(repo.complete).toHaveBeenCalledWith(expect.objectContaining({ job, cursor: "cursor-2" }));
  });

  it("checkpoints a provider cursor without completing a multi-page job", async () => {
    const repo = repository();
    const adapter = { key: "official", fetch: vi.fn().mockResolvedValue({ items: [candidate], nextCursor: "cursor-2", hasMore: true }) };
    const result = await new TrendIngestionWorker(repo, new TrendAdapterRegistry([adapter]), () => now).run({ workerId: "worker-1", limit: 1 });

    expect(result.checkpointed).toBe(1);
    expect(repo.checkpoint).toHaveBeenCalledWith(expect.objectContaining({ job, cursor: "cursor-2" }));
    expect(repo.complete).not.toHaveBeenCalled();
  });

  it("fails safely without making an external call when no adapter is configured", async () => {
    const repo = repository();
    const result = await new TrendIngestionWorker(repo, new TrendAdapterRegistry([]), () => now).run({ workerId: "worker-1", limit: 1 });

    expect(result).toMatchObject({ claimed: 1, retried: 1, succeeded: 0 });
    expect(repo.retry).toHaveBeenCalledWith(expect.objectContaining({ job, errorCode: "TREND_ADAPTER_NOT_CONFIGURED" }));
    expect(repo.persistPage).not.toHaveBeenCalled();
  });

  it("rejects the entire page when an adapter violates the normalized contract", async () => {
    const repo = repository();
    const adapter = { key: "official", fetch: vi.fn().mockResolvedValue({ items: [{ ...candidate, sourceUrl: "http://unsafe.example/trend" }], nextCursor: null, hasMore: false }) };
    const result = await new TrendIngestionWorker(repo, new TrendAdapterRegistry([adapter]), () => now).run({ workerId: "worker-1", limit: 1 });

    expect(result.retried).toBe(1);
    expect(repo.retry).toHaveBeenCalledWith(expect.objectContaining({ errorCode: "TREND_ADAPTER_RESPONSE_INVALID" }));
    expect(repo.persistPage).not.toHaveBeenCalled();
  });

  it("rejects a non-advancing cursor instead of looping the durable job", async () => {
    const sameCursorJob = { ...job, cursor: "cursor-1" };
    const repo = repository({ claim: vi.fn().mockResolvedValueOnce(sameCursorJob).mockResolvedValue(null) });
    const adapter = { key: "official", fetch: vi.fn().mockResolvedValue({ items: [candidate], nextCursor: "cursor-1", hasMore: true }) };
    const result = await new TrendIngestionWorker(repo, new TrendAdapterRegistry([adapter]), () => now).run({ workerId: "worker-1", limit: 1 });

    expect(result.retried).toBe(1);
    expect(repo.retry).toHaveBeenCalledWith(expect.objectContaining({ errorCode: "TREND_ADAPTER_CURSOR_STALLED" }));
    expect(repo.persistPage).not.toHaveBeenCalled();
  });

  it("uses the job-pinned evaluation instant so retry timing cannot change its ranking digest", async () => {
    const evaluatedAt = new Date("2026-09-04T11:30:00.000Z");
    const pinnedJob = { ...job, rankingEvaluatedAt: evaluatedAt };
    const repo = repository({ claim: vi.fn().mockResolvedValueOnce(pinnedJob).mockResolvedValue(null) });
    const adapter = { key: "official", fetch: vi.fn().mockResolvedValue({ items: [candidate], nextCursor: null, hasMore: false }) };
    await new TrendIngestionWorker(repo, new TrendAdapterRegistry([adapter]), () => now).run({ workerId: "worker-1", limit: 1 });

    expect(repo.persistPage).toHaveBeenCalledWith(expect.objectContaining({ items: [expect.objectContaining({ ranking: expect.objectContaining({ evaluatedAt: evaluatedAt.toISOString() }) })] }));
  });
});
