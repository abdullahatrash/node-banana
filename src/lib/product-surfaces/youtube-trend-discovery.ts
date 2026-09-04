import "server-only";

import { randomUUID } from "node:crypto";
import { and, asc, eq, gt, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { youtubeTrendDiscoveryEntries, youtubeTrendDiscoveryJobs, youtubeTrendDiscoverySources } from "@/lib/db/schema";

export const YOUTUBE_TREND_RETENTION_MS = 30 * 24 * 60 * 60_000;
const YOUTUBE_API_URL = "https://www.googleapis.com/youtube/v3/videos";
const counterSchema = z.string().regex(/^(0|[1-9][0-9]*)$/).nullable();
const regionSchema = z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/);
const categorySchema = z.string().trim().regex(/^(0|[1-9][0-9]*)$/);

export const youtubeTrendCommandSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("enable"), regionCode: regionSchema, categoryId: categorySchema.default("0"), displayName: z.string().trim().min(1).max(200), scheduleMinutes: z.number().int().min(60).max(10_080), pageSize: z.number().int().min(1).max(50) }).strict(),
  z.object({ action: z.enum(["pause", "resume", "run_now", "remove"]), sourceId: z.string().trim().min(1).max(200) }).strict(),
]);

const youtubeResponseSchema = z.object({
  items: z.array(z.object({
    id: z.string().trim().min(1).max(32),
    snippet: z.object({
      publishedAt: z.string().datetime(), channelId: z.string().trim().min(1).max(200), channelTitle: z.string().trim().min(1).max(200), title: z.string().trim().min(1).max(240),
      thumbnails: z.record(z.string(), z.object({ url: z.string().url() }).passthrough()).optional(),
    }).passthrough(),
    statistics: z.object({ viewCount: counterSchema.optional(), likeCount: counterSchema.optional(), commentCount: counterSchema.optional() }).passthrough().optional(),
  }).passthrough()).max(50),
}).passthrough();

export interface YoutubeTrendItem {
  videoId: string;
  providerRank: number;
  title: string;
  channelId: string;
  channelTitle: string;
  sourceUrl: string;
  thumbnailUrl: string | null;
  publishedAt: Date;
  viewCount: string | null;
  likeCount: string | null;
  commentCount: string | null;
  observedAt: Date;
  expiresAt: Date;
}

export type YoutubeFailureKind = "permanent" | "quota" | "transient";

export class YoutubeTrendDiscoveryError extends Error {
  constructor(public readonly code: string, public readonly kind: YoutubeFailureKind, public readonly retryAt: Date | null = null) { super(code); }
}

function configuredValue(value: string | undefined) { return Boolean(value?.trim()); }

function disclosureUrl(value: string | undefined) {
  if (!value?.trim()) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || (url.protocol === "http:" && ["localhost", "127.0.0.1", "::1"].includes(url.hostname)) ? url.toString() : null;
  } catch { return null; }
}

export function youtubeTrendDiscoveryCapability(env: NodeJS.ProcessEnv = process.env) {
  const enabled = env.YOUTUBE_TREND_DISCOVERY_ENABLED === "true";
  const keyConfigured = configuredValue(env.YOUTUBE_DATA_API_KEY);
  const privacyUrl = disclosureUrl(env.NEXT_PUBLIC_PRIVACY_URL);
  const termsUrl = disclosureUrl(env.NEXT_PUBLIC_TERMS_URL);
  const disclosuresConfigured = Boolean(privacyUrl && termsUrl);
  return { enabled, keyConfigured, disclosuresConfigured, configured: enabled && keyConfigured && disclosuresConfigured, privacyUrl, termsUrl };
}

function safeThumbnail(thumbnails: Record<string, { url: string }> | undefined) {
  const raw = thumbnails?.maxres?.url ?? thumbnails?.standard?.url ?? thumbnails?.high?.url ?? thumbnails?.medium?.url ?? thumbnails?.default?.url;
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" && (url.hostname === "i.ytimg.com" || url.hostname.endsWith(".ytimg.com")) ? url.toString() : null;
  } catch { return null; }
}

function retryAfter(response: Response, at: Date) {
  const value = response.headers.get("retry-after");
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return new Date(at.getTime() + seconds * 1_000);
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function providerReason(body: unknown) {
  const parsed = z.object({ error: z.object({ errors: z.array(z.object({ reason: z.string().max(200) }).passthrough()).optional() }).passthrough() }).safeParse(body);
  return parsed.success ? parsed.data.error.errors?.[0]?.reason ?? null : null;
}

export async function fetchYoutubeMostPopular(input: {
  apiKey: string; regionCode: string; categoryId: string; pageSize: number; requestedAt: Date;
  fetchImpl?: typeof fetch;
}): Promise<YoutubeTrendItem[]> {
  const regionCode = regionSchema.parse(input.regionCode);
  const categoryId = categorySchema.parse(input.categoryId);
  const pageSize = Math.max(1, Math.min(50, Math.floor(input.pageSize)));
  const url = new URL(YOUTUBE_API_URL);
  url.searchParams.set("part", "snippet,statistics");
  url.searchParams.set("chart", "mostPopular");
  url.searchParams.set("regionCode", regionCode);
  if (categoryId !== "0") url.searchParams.set("videoCategoryId", categoryId);
  url.searchParams.set("maxResults", String(pageSize));
  url.searchParams.set("fields", "items(id,snippet(publishedAt,channelId,channelTitle,title,thumbnails),statistics(viewCount,likeCount,commentCount))");
  url.searchParams.set("key", input.apiKey);

  let response: Response;
  try {
    response = await (input.fetchImpl ?? fetch)(url, { method: "GET", cache: "no-store", signal: AbortSignal.timeout(20_000) });
  } catch {
    throw new YoutubeTrendDiscoveryError("YOUTUBE_API_UNAVAILABLE", "transient");
  }
  if (!response.ok) {
    let body: unknown = null;
    try { body = await response.json(); } catch { /* redacted provider response */ }
    const reason = providerReason(body);
    if (response.status === 429 || response.status === 408 || response.status >= 500) throw new YoutubeTrendDiscoveryError("YOUTUBE_API_TRANSIENT", "transient", retryAfter(response, input.requestedAt));
    if (reason && ["quotaExceeded", "dailyLimitExceeded", "userRateLimitExceeded"].includes(reason)) throw new YoutubeTrendDiscoveryError("YOUTUBE_API_QUOTA_EXHAUSTED", "quota");
    if (response.status === 401 || response.status === 403) throw new YoutubeTrendDiscoveryError("YOUTUBE_API_CREDENTIALS_INVALID", "permanent");
    throw new YoutubeTrendDiscoveryError(reason === "videoChartNotFound" ? "YOUTUBE_CHART_UNAVAILABLE" : "YOUTUBE_API_REQUEST_INVALID", "permanent");
  }

  let body: unknown;
  try { body = await response.json(); } catch { throw new YoutubeTrendDiscoveryError("YOUTUBE_API_RESPONSE_INVALID", "permanent"); }
  const parsed = youtubeResponseSchema.safeParse(body);
  if (!parsed.success) throw new YoutubeTrendDiscoveryError("YOUTUBE_API_RESPONSE_INVALID", "permanent");
  const expiresAt = new Date(input.requestedAt.getTime() + YOUTUBE_TREND_RETENTION_MS);
  const items = parsed.data.items.flatMap((item, index) => {
    const publishedAt = new Date(item.snippet.publishedAt);
    if (publishedAt > input.requestedAt) return [];
    return [{
      videoId: item.id, providerRank: index + 1, title: item.snippet.title, channelId: item.snippet.channelId, channelTitle: item.snippet.channelTitle,
      sourceUrl: `https://www.youtube.com/watch?v=${item.id}`, thumbnailUrl: safeThumbnail(item.snippet.thumbnails), publishedAt,
      viewCount: item.statistics?.viewCount ?? null, likeCount: item.statistics?.likeCount ?? null, commentCount: item.statistics?.commentCount ?? null,
      observedAt: input.requestedAt, expiresAt,
    }];
  });
  if (parsed.data.items.length > 0 && items.length === 0) throw new YoutubeTrendDiscoveryError("YOUTUBE_API_RESPONSE_INVALID", "permanent");
  return items;
}

type SourceRow = typeof youtubeTrendDiscoverySources.$inferSelect;
type JobRow = typeof youtubeTrendDiscoveryJobs.$inferSelect;
export type ClaimedYoutubeTrendJob = JobRow & { source: SourceRow };

export interface YoutubeTrendRepository {
  purgeExpired(at: Date): Promise<number>;
  purgeAll(): Promise<number>;
  scheduleDue(at: Date, limit: number): Promise<number>;
  recoverExpired(at: Date, limit: number): Promise<number>;
  claim(workerId: string, at: Date): Promise<ClaimedYoutubeTrendJob | null>;
  complete(job: ClaimedYoutubeTrendJob, items: YoutubeTrendItem[], at: Date): Promise<number>;
  fail(job: ClaimedYoutubeTrendJob, error: YoutubeTrendDiscoveryError, at: Date): Promise<"failed_known" | "retried" | "lost_lease">;
}

function owns(job: ClaimedYoutubeTrendJob, at: Date) {
  return and(eq(youtubeTrendDiscoveryJobs.workspaceId, job.workspaceId), eq(youtubeTrendDiscoveryJobs.id, job.id), eq(youtubeTrendDiscoveryJobs.state, "claimed"), eq(youtubeTrendDiscoveryJobs.leaseOwner, job.leaseOwner!), eq(youtubeTrendDiscoveryJobs.leaseGeneration, job.leaseGeneration), gt(youtubeTrendDiscoveryJobs.leaseExpiresAt, at));
}

export async function listYoutubeTrendDiscovery(workspaceId: string, at = new Date()) {
  const capability = youtubeTrendDiscoveryCapability();
  const [sources, entries] = await Promise.all([
    getDb().select().from(youtubeTrendDiscoverySources).where(eq(youtubeTrendDiscoverySources.workspaceId, workspaceId)).orderBy(asc(youtubeTrendDiscoverySources.createdAt), asc(youtubeTrendDiscoverySources.id)),
    capability.configured ? getDb().select().from(youtubeTrendDiscoveryEntries).where(and(eq(youtubeTrendDiscoveryEntries.workspaceId, workspaceId), sql`${youtubeTrendDiscoveryEntries.expiresAt} > ${at}`)).orderBy(asc(youtubeTrendDiscoveryEntries.sourceId), asc(youtubeTrendDiscoveryEntries.providerRank), asc(youtubeTrendDiscoveryEntries.videoId)).limit(500) : Promise.resolve([]),
  ]);
  return {
    capability,
    sources: sources.map((source) => ({ ...source, nextRunAt: source.nextRunAt.toISOString(), lastRefreshedAt: source.lastRefreshedAt?.toISOString() ?? null, createdAt: source.createdAt.toISOString(), updatedAt: source.updatedAt.toISOString(), estimatedDailyQuotaUnits: Math.ceil(1_440 / source.scheduleMinutes) })),
    entries: entries.map((entry) => ({ ...entry, publishedAt: entry.publishedAt.toISOString(), observedAt: entry.observedAt.toISOString(), expiresAt: entry.expiresAt.toISOString(), updatedAt: entry.updatedAt.toISOString() })),
  };
}

export async function configureYoutubeTrendDiscovery(input: z.infer<typeof youtubeTrendCommandSchema> & { workspaceId: string; userId: string; at?: Date }) {
  const at = input.at ?? new Date();
  if (input.action === "enable") {
    if (!youtubeTrendDiscoveryCapability().configured) throw new YoutubeTrendDiscoveryError("YOUTUBE_DISCOVERY_NOT_CONFIGURED", "permanent");
    const categoryId = input.categoryId || "0";
    const id = `youtube-most-popular:${input.regionCode}:${categoryId}`;
    const values = { workspaceId: input.workspaceId, id, regionCode: input.regionCode, categoryId, displayName: input.displayName, state: "active", scheduleMinutes: input.scheduleMinutes, pageSize: input.pageSize, nextRunAt: at, lastErrorCode: null, createdByUserId: input.userId, createdAt: at, updatedAt: at };
    const [source] = await getDb().insert(youtubeTrendDiscoverySources).values(values).onConflictDoUpdate({ target: [youtubeTrendDiscoverySources.workspaceId, youtubeTrendDiscoverySources.regionCode, youtubeTrendDiscoverySources.categoryId], set: { displayName: values.displayName, state: "active", scheduleMinutes: values.scheduleMinutes, pageSize: values.pageSize, nextRunAt: at, lastErrorCode: null, updatedAt: at } }).returning();
    return source;
  }
  if (input.action === "remove") {
    const [removed] = await getDb().delete(youtubeTrendDiscoverySources).where(and(eq(youtubeTrendDiscoverySources.workspaceId, input.workspaceId), eq(youtubeTrendDiscoverySources.id, input.sourceId))).returning({ id: youtubeTrendDiscoverySources.id });
    if (!removed) throw new YoutubeTrendDiscoveryError("YOUTUBE_SOURCE_NOT_FOUND", "permanent");
    return removed;
  }
  if ((input.action === "resume" || input.action === "run_now") && !youtubeTrendDiscoveryCapability().configured) throw new YoutubeTrendDiscoveryError("YOUTUBE_DISCOVERY_NOT_CONFIGURED", "permanent");
  const state = input.action === "pause" ? "paused" : "active";
  const [source] = await getDb().update(youtubeTrendDiscoverySources).set({ state, nextRunAt: input.action === "run_now" ? at : undefined, lastErrorCode: null, updatedAt: at }).where(and(eq(youtubeTrendDiscoverySources.workspaceId, input.workspaceId), eq(youtubeTrendDiscoverySources.id, input.sourceId))).returning();
  if (!source) throw new YoutubeTrendDiscoveryError("YOUTUBE_SOURCE_NOT_FOUND", "permanent");
  return source;
}

export class PostgresYoutubeTrendRepository implements YoutubeTrendRepository {
  async purgeExpired(at: Date) {
    const rows = await getDb().delete(youtubeTrendDiscoveryEntries).where(lte(youtubeTrendDiscoveryEntries.expiresAt, at)).returning({ videoId: youtubeTrendDiscoveryEntries.videoId });
    return rows.length;
  }

  async purgeAll() {
    const rows = await getDb().delete(youtubeTrendDiscoveryEntries).returning({ videoId: youtubeTrendDiscoveryEntries.videoId });
    return rows.length;
  }

  async scheduleDue(at: Date, limit: number) {
    return getDb().transaction(async (tx) => {
      const sources = await tx.select().from(youtubeTrendDiscoverySources).where(and(eq(youtubeTrendDiscoverySources.state, "active"), lte(youtubeTrendDiscoverySources.nextRunAt, at))).orderBy(asc(youtubeTrendDiscoverySources.nextRunAt), asc(youtubeTrendDiscoverySources.workspaceId), asc(youtubeTrendDiscoverySources.id)).limit(limit).for("update", { skipLocked: true });
      let scheduled = 0;
      for (const source of sources) {
        const [job] = await tx.insert(youtubeTrendDiscoveryJobs).values({ workspaceId: source.workspaceId, id: randomUUID(), sourceId: source.id, sourceKey: `scheduled:${source.nextRunAt.toISOString()}`, state: "queued", nextAttemptAt: at, requestedAt: at, updatedAt: at }).onConflictDoNothing().returning({ id: youtubeTrendDiscoveryJobs.id });
        if (job) scheduled += 1;
        const base = source.nextRunAt > at ? source.nextRunAt : at;
        await tx.update(youtubeTrendDiscoverySources).set({ nextRunAt: new Date(base.getTime() + source.scheduleMinutes * 60_000), updatedAt: at }).where(and(eq(youtubeTrendDiscoverySources.workspaceId, source.workspaceId), eq(youtubeTrendDiscoverySources.id, source.id)));
      }
      return scheduled;
    });
  }

  async recoverExpired(at: Date, limit: number) {
    return getDb().transaction(async (tx) => {
      const jobs = await tx.select().from(youtubeTrendDiscoveryJobs).where(and(eq(youtubeTrendDiscoveryJobs.state, "claimed"), lte(youtubeTrendDiscoveryJobs.leaseExpiresAt, at))).orderBy(asc(youtubeTrendDiscoveryJobs.leaseExpiresAt), asc(youtubeTrendDiscoveryJobs.id)).limit(limit).for("update", { skipLocked: true });
      for (const job of jobs) {
        const terminal = job.attempt >= job.maxAttempts;
        await tx.update(youtubeTrendDiscoveryJobs).set({ state: terminal ? "failed_known" : "queued", leaseOwner: null, leaseExpiresAt: null, failureCode: "YOUTUBE_WORKER_LEASE_EXPIRED", nextAttemptAt: at, finishedAt: terminal ? at : null, updatedAt: at }).where(and(eq(youtubeTrendDiscoveryJobs.workspaceId, job.workspaceId), eq(youtubeTrendDiscoveryJobs.id, job.id), eq(youtubeTrendDiscoveryJobs.leaseGeneration, job.leaseGeneration)));
      }
      return jobs.length;
    });
  }

  async claim(workerId: string, at: Date): Promise<ClaimedYoutubeTrendJob | null> {
    return getDb().transaction(async (tx) => {
      const [row] = await tx.select({ job: youtubeTrendDiscoveryJobs, source: youtubeTrendDiscoverySources }).from(youtubeTrendDiscoveryJobs).innerJoin(youtubeTrendDiscoverySources, and(eq(youtubeTrendDiscoverySources.workspaceId, youtubeTrendDiscoveryJobs.workspaceId), eq(youtubeTrendDiscoverySources.id, youtubeTrendDiscoveryJobs.sourceId), eq(youtubeTrendDiscoverySources.state, "active"))).where(and(eq(youtubeTrendDiscoveryJobs.state, "queued"), lte(youtubeTrendDiscoveryJobs.nextAttemptAt, at))).orderBy(asc(youtubeTrendDiscoveryJobs.nextAttemptAt), asc(youtubeTrendDiscoveryJobs.workspaceId), asc(youtubeTrendDiscoveryJobs.id)).limit(1).for("update", { skipLocked: true });
      if (!row) return null;
      const leaseExpiresAt = new Date(at.getTime() + 120_000);
      const [job] = await tx.update(youtubeTrendDiscoveryJobs).set({ state: "claimed", attempt: row.job.attempt + 1, leaseOwner: workerId, leaseExpiresAt, leaseGeneration: row.job.leaseGeneration + 1, failureCode: null, updatedAt: at }).where(and(eq(youtubeTrendDiscoveryJobs.workspaceId, row.job.workspaceId), eq(youtubeTrendDiscoveryJobs.id, row.job.id), eq(youtubeTrendDiscoveryJobs.state, "queued"), eq(youtubeTrendDiscoveryJobs.leaseGeneration, row.job.leaseGeneration))).returning();
      return job ? { ...job, source: row.source } : null;
    });
  }

  async complete(job: ClaimedYoutubeTrendJob, items: YoutubeTrendItem[], at: Date) {
    return getDb().transaction(async (tx) => {
      const [locked] = await tx.select({ id: youtubeTrendDiscoveryJobs.id }).from(youtubeTrendDiscoveryJobs).where(owns(job, at)).limit(1).for("update");
      if (!locked) throw new YoutubeTrendDiscoveryError("YOUTUBE_WORKER_LEASE_LOST", "permanent");
      await tx.delete(youtubeTrendDiscoveryEntries).where(and(eq(youtubeTrendDiscoveryEntries.workspaceId, job.workspaceId), eq(youtubeTrendDiscoveryEntries.sourceId, job.sourceId)));
      if (items.length) await tx.insert(youtubeTrendDiscoveryEntries).values(items.map((item) => ({ workspaceId: job.workspaceId, sourceId: job.sourceId, ...item, updatedAt: at })));
      await tx.update(youtubeTrendDiscoveryJobs).set({ state: "succeeded", leaseOwner: null, leaseExpiresAt: null, failureCode: null, finishedAt: at, updatedAt: at }).where(owns(job, at));
      await tx.update(youtubeTrendDiscoverySources).set({ lastRefreshedAt: at, lastErrorCode: null, updatedAt: at }).where(and(eq(youtubeTrendDiscoverySources.workspaceId, job.workspaceId), eq(youtubeTrendDiscoverySources.id, job.sourceId)));
      return items.length;
    });
  }

  async fail(job: ClaimedYoutubeTrendJob, error: YoutubeTrendDiscoveryError, at: Date) {
    const terminal = error.kind !== "transient" || job.attempt >= job.maxAttempts;
    const retryAt = error.retryAt ?? (error.kind === "quota" ? new Date(at.getTime() + 24 * 60 * 60_000) : new Date(at.getTime() + Math.min(60, 2 ** job.attempt) * 60_000));
    return getDb().transaction(async (tx) => {
      const [updated] = await tx.update(youtubeTrendDiscoveryJobs).set({ state: terminal ? "failed_known" : "queued", leaseOwner: null, leaseExpiresAt: null, failureCode: error.code, nextAttemptAt: retryAt, finishedAt: terminal ? at : null, updatedAt: at }).where(owns(job, at)).returning({ id: youtubeTrendDiscoveryJobs.id });
      if (!updated) return "lost_lease" as const;
      await tx.update(youtubeTrendDiscoverySources).set({ state: error.kind === "permanent" ? "paused" : undefined, nextRunAt: error.kind === "quota" ? retryAt : undefined, lastErrorCode: error.code, updatedAt: at }).where(and(eq(youtubeTrendDiscoverySources.workspaceId, job.workspaceId), eq(youtubeTrendDiscoverySources.id, job.sourceId)));
      return terminal ? "failed_known" as const : "retried" as const;
    });
  }
}

export async function runYoutubeTrendDiscoveryWorker(input: { workerId: string; at?: Date; limit?: number; repository?: YoutubeTrendRepository; fetchImpl?: typeof fetch; env?: NodeJS.ProcessEnv; now?: () => Date }) {
  const now = input.now ?? (() => new Date());
  const at = input.at ?? now();
  const limit = Math.max(1, Math.min(input.limit ?? 20, 100));
  const repository = input.repository ?? new PostgresYoutubeTrendRepository();
  const capability = youtubeTrendDiscoveryCapability(input.env);
  const purged = capability.enabled ? await repository.purgeExpired(at) : await repository.purgeAll();
  const summary = { configured: capability.configured, purged, scheduled: 0, recovered: 0, claimed: 0, succeeded: 0, retried: 0, failedKnown: 0, lostLease: 0, items: 0 };
  if (!capability.configured) return summary;
  [summary.scheduled, summary.recovered] = await Promise.all([repository.scheduleDue(at, limit), repository.recoverExpired(at, limit)]);
  for (let index = 0; index < limit; index += 1) {
    const claimAt = now();
    const job = await repository.claim(input.workerId, claimAt);
    if (!job) break;
    summary.claimed += 1;
    try {
      const items = await fetchYoutubeMostPopular({ apiKey: (input.env ?? process.env).YOUTUBE_DATA_API_KEY!.trim(), regionCode: job.source.regionCode, categoryId: job.source.categoryId, pageSize: job.source.pageSize, requestedAt: claimAt, fetchImpl: input.fetchImpl });
      summary.items += await repository.complete(job, items, now());
      summary.succeeded += 1;
    } catch (cause) {
      const error = cause instanceof YoutubeTrendDiscoveryError ? cause : new YoutubeTrendDiscoveryError("YOUTUBE_WORKER_FAILED", "transient");
      const state = await repository.fail(job, error, now());
      if (state === "retried") summary.retried += 1; else if (state === "failed_known") summary.failedKnown += 1; else summary.lostLease += 1;
    }
  }
  return summary;
}
