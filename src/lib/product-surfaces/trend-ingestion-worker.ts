import "server-only";

import { z } from "zod";
import { rankTrendCandidate } from "./trend-ranking";
import { trendIngestionCandidateSchema, type TrendIngestionAdapter, type TrendRankingContext, type TrendRankingEvidence, type TrendSourceKind } from "./trend-types";

export interface ClaimedTrendIngestionJob {
  workspaceId: string;
  id: string;
  sourceId: string;
  sourceKind: TrendSourceKind;
  adapterKey: string;
  cursor: string | null;
  sourceKey: string;
  leaseOwner: string;
  leaseEpoch: number;
  attempt: number;
  maxAttempts: number;
  rankingContext: TrendRankingContext;
}

export interface RankedTrendCandidate {
  candidate: z.infer<typeof trendIngestionCandidateSchema>;
  ranking: TrendRankingEvidence;
}

export interface TrendIngestionRepository {
  scheduleDue(input: { at: Date; limit: number }): Promise<number>;
  claim(input: { workerId: string; at: Date; leaseUntil: Date }): Promise<ClaimedTrendIngestionJob | null>;
  persistPage(input: { job: ClaimedTrendIngestionJob; items: RankedTrendCandidate[]; at: Date; leaseUntil: Date }): Promise<{ inserted: number; updated: number; replayed: number; restricted: number }>;
  checkpoint(input: { job: ClaimedTrendIngestionJob; cursor: string; at: Date }): Promise<boolean>;
  complete(input: { job: ClaimedTrendIngestionJob; cursor: string | null; at: Date }): Promise<boolean>;
  retry(input: { job: ClaimedTrendIngestionJob; errorCode: string; at: Date; nextAttemptAt: Date }): Promise<"queued" | "failed_known" | "lost_lease">;
}

const pageSchema = z.object({
  items: z.array(trendIngestionCandidateSchema).max(100),
  nextCursor: z.string().trim().min(1).max(500).nullable(),
  hasMore: z.boolean(),
}).strict().superRefine((page, context) => {
  if (page.hasMore && !page.nextCursor) context.addIssue({ code: "custom", path: ["nextCursor"], message: "A continuing page requires a cursor." });
});

export class TrendAdapterRegistry {
  private readonly adapters = new Map<string, TrendIngestionAdapter>();

  constructor(adapters: TrendIngestionAdapter[]) {
    for (const adapter of adapters) {
      if (!/^[a-z][a-z0-9._-]{1,119}$/.test(adapter.key) || this.adapters.has(adapter.key)) throw new Error("TREND_ADAPTER_REGISTRY_INVALID");
      this.adapters.set(adapter.key, adapter);
    }
  }

  get(key: string) { return this.adapters.get(key) ?? null; }
}

/**
 * Provider-neutral orchestration only. Adapters perform reads; the worker owns
 * validation, ranking, durable progress, retries, and idempotent persistence.
 */
export class TrendIngestionWorker {
  constructor(
    private readonly repository: TrendIngestionRepository,
    private readonly adapters: TrendAdapterRegistry,
    private readonly now: () => Date = () => new Date(),
    private readonly leaseMilliseconds = 120_000,
  ) {}

  async run(input: { workerId: string; limit?: number }) {
    const limit = Math.max(1, Math.min(input.limit ?? 20, 100));
    const scheduled = await this.repository.scheduleDue({ at: this.now(), limit });
    const summary = { scheduled, claimed: 0, succeeded: 0, checkpointed: 0, retried: 0, failedKnown: 0, lostLease: 0, ingested: 0, updated: 0, replayed: 0, restricted: 0 };
    for (let index = 0; index < limit; index += 1) {
      const claimedAt = this.now();
      const job = await this.repository.claim({ workerId: input.workerId, at: claimedAt, leaseUntil: this.leaseAfter(claimedAt) });
      if (!job) break;
      summary.claimed += 1;
      const adapter = this.adapters.get(job.adapterKey);
      if (!adapter) {
        this.recordRetry(summary, await this.repository.retry({ job, errorCode: "TREND_ADAPTER_NOT_CONFIGURED", at: this.now(), nextAttemptAt: this.nextAttempt(job.attempt) }));
        continue;
      }
      let rawPage: unknown;
      try {
        rawPage = await adapter.fetch({ workspaceId: job.workspaceId, sourceId: job.sourceId, cursor: job.cursor, limit: 100, requestedAt: claimedAt });
      } catch {
        this.recordRetry(summary, await this.repository.retry({ job, errorCode: "TREND_ADAPTER_UNAVAILABLE", at: this.now(), nextAttemptAt: this.nextAttempt(job.attempt) }));
        continue;
      }
      const page = pageSchema.safeParse(rawPage);
      if (!page.success) {
        this.recordRetry(summary, await this.repository.retry({ job, errorCode: "TREND_ADAPTER_RESPONSE_INVALID", at: this.now(), nextAttemptAt: this.nextAttempt(job.attempt) }));
        continue;
      }
      if (page.data.hasMore && page.data.nextCursor === job.cursor) {
        this.recordRetry(summary, await this.repository.retry({ job, errorCode: "TREND_ADAPTER_CURSOR_STALLED", at: this.now(), nextAttemptAt: this.nextAttempt(job.attempt) }));
        continue;
      }
      try {
        const ranked = page.data.items.map((candidate) => ({ candidate, ranking: rankTrendCandidate({ candidate, context: job.rankingContext, evaluatedAt: claimedAt }) }));
        const persistedAt = this.now();
        const persisted = await this.repository.persistPage({ job, items: ranked, at: persistedAt, leaseUntil: this.leaseAfter(persistedAt) });
        summary.ingested += persisted.inserted;
        summary.updated += persisted.updated;
        summary.replayed += persisted.replayed;
        summary.restricted += persisted.restricted;
        if (page.data.hasMore) {
          if (await this.repository.checkpoint({ job, cursor: page.data.nextCursor!, at: this.now() })) summary.checkpointed += 1;
          else summary.lostLease += 1;
        } else if (await this.repository.complete({ job, cursor: page.data.nextCursor, at: this.now() })) summary.succeeded += 1;
        else summary.lostLease += 1;
      } catch {
        this.recordRetry(summary, await this.repository.retry({ job, errorCode: "TREND_INGESTION_FAILED", at: this.now(), nextAttemptAt: this.nextAttempt(job.attempt) }));
      }
    }
    return summary;
  }

  private leaseAfter(at: Date) { return new Date(at.getTime() + this.leaseMilliseconds); }
  private nextAttempt(attempt: number) { return new Date(this.now().getTime() + Math.min(6 * 60 * 60_000, 60_000 * 2 ** Math.min(attempt, 8))); }
  private recordRetry(summary: { retried: number; failedKnown: number; lostLease: number }, state: "queued" | "failed_known" | "lost_lease") {
    if (state === "queued") summary.retried += 1;
    else if (state === "failed_known") summary.failedKnown += 1;
    else summary.lostLease += 1;
  }
}
