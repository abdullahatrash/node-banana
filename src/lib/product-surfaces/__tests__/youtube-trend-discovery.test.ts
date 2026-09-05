import { describe, expect, it, vi } from "vitest";
import {
  fetchYoutubeMostPopular,
  runYoutubeTrendDiscoveryWorker,
  YoutubeTrendDiscoveryError,
  youtubeTrendDiscoveryCapability,
  type ClaimedYoutubeTrendJob,
  type YoutubeTrendRepository,
} from "../youtube-trend-discovery";

const NOW = new Date("2026-09-04T12:00:00.000Z");

function okResponse() {
  return new Response(JSON.stringify({ items: [
    { id: "video-b", snippet: { publishedAt: "2026-09-03T10:00:00.000Z", channelId: "channel-b", channelTitle: "قناة ب", title: "الفيديو الثاني", thumbnails: { high: { url: "https://i.ytimg.com/vi/video-b/hqdefault.jpg" } } }, statistics: { viewCount: "18446744073709551615", commentCount: "42" } },
    { id: "video-a", snippet: { publishedAt: "2026-09-02T10:00:00.000Z", channelId: "channel-a", channelTitle: "Channel A", title: "First video", thumbnails: { high: { url: "https://tracker.example/thumb.jpg" } } }, statistics: { viewCount: "9", likeCount: "2" } },
  ] }), { status: 200, headers: { "content-type": "application/json" } });
}

describe("YouTube most-popular adapter", () => {
  it("uses the official one-unit endpoint and preserves provider order and unsigned-long counters", async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL) => okResponse());
    const items = await fetchYoutubeMostPopular({ apiKey: "secret-key", regionCode: "sa", categoryId: "0", pageSize: 99, requestedAt: NOW, fetchImpl: fetchImpl as typeof fetch });
    const url = new URL(String(fetchImpl.mock.calls[0]?.[0]));
    expect(url.origin + url.pathname).toBe("https://www.googleapis.com/youtube/v3/videos");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ part: "snippet,statistics", chart: "mostPopular", regionCode: "SA", maxResults: "50", key: "secret-key" });
    expect(url.searchParams.has("videoCategoryId")).toBe(false);
    expect(items.map((item) => [item.videoId, item.providerRank])).toEqual([["video-b", 1], ["video-a", 2]]);
    expect(items[0]?.viewCount).toBe("18446744073709551615");
    expect(items[0]?.likeCount).toBeNull();
    expect(items[1]?.thumbnailUrl).toBeNull();
    expect(items[0]?.expiresAt.toISOString()).toBe("2026-10-04T12:00:00.000Z");
  });

  it("classifies quota and permanent failures without exposing credentials", async () => {
    const quota = vi.fn(async () => new Response(JSON.stringify({ error: { errors: [{ reason: "quotaExceeded" }] } }), { status: 403 }));
    const promise = fetchYoutubeMostPopular({ apiKey: "never-show-this", regionCode: "AE", categoryId: "10", pageSize: 10, requestedAt: NOW, fetchImpl: quota as typeof fetch });
    await expect(promise).rejects.toMatchObject({ code: "YOUTUBE_API_QUOTA_EXHAUSTED", kind: "quota" });
    await expect(promise).rejects.not.toThrow(/never-show-this/);
  });

  it("fails closed until the key, switch, and public disclosures are all configured", () => {
    expect(youtubeTrendDiscoveryCapability({ NODE_ENV: "test", YOUTUBE_TREND_DISCOVERY_ENABLED: "true", YOUTUBE_DATA_API_KEY: "key" })).toMatchObject({ configured: false, disclosuresConfigured: false });
    expect(youtubeTrendDiscoveryCapability({ NODE_ENV: "test", YOUTUBE_TREND_DISCOVERY_ENABLED: "true", YOUTUBE_DATA_API_KEY: "key", NEXT_PUBLIC_TERMS_URL: "https://example.com/terms", NEXT_PUBLIC_PRIVACY_URL: "https://example.com/privacy" })).toMatchObject({ configured: true, keyConfigured: true, disclosuresConfigured: true, contentAdaptationApproved: false, contentAdaptationConfigured: false });
    expect(youtubeTrendDiscoveryCapability({ NODE_ENV: "test", YOUTUBE_TREND_DISCOVERY_ENABLED: "true", YOUTUBE_DATA_API_KEY: "key", NEXT_PUBLIC_TERMS_URL: "https://example.com/terms", NEXT_PUBLIC_PRIVACY_URL: "https://example.com/privacy", YOUTUBE_CONTENT_ADAPTATION_APPROVED: "true" })).toMatchObject({ configured: true, contentAdaptationApproved: true, contentAdaptationConfigured: true });
  });
});

describe("YouTube trend worker", () => {
  it("purges expired data even while provider access is disabled and spends no quota", async () => {
    const repository = { purgeExpired: vi.fn(async () => 0), purgeAll: vi.fn(async () => 3), scheduleDue: vi.fn(), recoverExpired: vi.fn(), claim: vi.fn(), complete: vi.fn(), fail: vi.fn() } as unknown as YoutubeTrendRepository;
    const fetchImpl = vi.fn();
    const summary = await runYoutubeTrendDiscoveryWorker({ workerId: "worker", repository, fetchImpl: fetchImpl as typeof fetch, env: {} as NodeJS.ProcessEnv, now: () => NOW });
    expect(summary).toMatchObject({ configured: false, purged: 3, scheduled: 0, claimed: 0 });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(repository.purgeAll).toHaveBeenCalledOnce();
    expect(repository.purgeExpired).not.toHaveBeenCalled();
    expect(repository.scheduleDue).not.toHaveBeenCalled();
  });

  it("keeps the provider call outside repository operations and persists the complete provider-ordered page", async () => {
    const events: string[] = [];
    const claimed = { workspaceId: "workspace-1", id: "job-1", sourceId: "source-1", attempt: 1, maxAttempts: 4, source: { regionCode: "SA", categoryId: "0", pageSize: 25 } } as ClaimedYoutubeTrendJob;
    let claimedOnce = false;
    const repository: YoutubeTrendRepository = {
      purgeExpired: async () => 0,
      purgeAll: async () => 0,
      scheduleDue: async () => 1,
      recoverExpired: async () => 0,
      claim: async () => { events.push("claim"); if (claimedOnce) return null; claimedOnce = true; return claimed; },
      complete: async (_job, items) => { events.push(`complete:${items.map((item) => item.videoId).join(",")}`); return items.length; },
      fail: async () => "failed_known",
    };
    const fetchImpl = vi.fn(async () => { events.push("provider"); return okResponse(); });
    const env: NodeJS.ProcessEnv = { NODE_ENV: "test", YOUTUBE_TREND_DISCOVERY_ENABLED: "true", YOUTUBE_DATA_API_KEY: "key", NEXT_PUBLIC_TERMS_URL: "https://example.com/terms", NEXT_PUBLIC_PRIVACY_URL: "https://example.com/privacy" };
    const summary = await runYoutubeTrendDiscoveryWorker({ workerId: "worker", repository, fetchImpl: fetchImpl as typeof fetch, env, now: () => NOW });
    expect(events).toEqual(["claim", "provider", "complete:video-b,video-a", "claim"]);
    expect(summary).toMatchObject({ configured: true, scheduled: 1, claimed: 1, succeeded: 1, items: 2 });
  });

  it("hands a permanent credential failure to the repository without retrying the provider", async () => {
    const claimed = { workspaceId: "workspace-1", id: "job-1", sourceId: "source-1", attempt: 1, maxAttempts: 4, source: { regionCode: "SA", categoryId: "0", pageSize: 25 } } as ClaimedYoutubeTrendJob;
    let claimedOnce = false;
    const failures: YoutubeTrendDiscoveryError[] = [];
    const repository: YoutubeTrendRepository = {
      purgeExpired: async () => 0, purgeAll: async () => 0, scheduleDue: async () => 0, recoverExpired: async () => 0,
      claim: async () => { if (claimedOnce) return null; claimedOnce = true; return claimed; },
      complete: async () => 0,
      fail: async (_job, error) => { failures.push(error); return "failed_known"; },
    };
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ error: { errors: [{ reason: "keyInvalid" }] } }), { status: 403 }));
    const env: NodeJS.ProcessEnv = { NODE_ENV: "test", YOUTUBE_TREND_DISCOVERY_ENABLED: "true", YOUTUBE_DATA_API_KEY: "key", NEXT_PUBLIC_TERMS_URL: "https://example.com/terms", NEXT_PUBLIC_PRIVACY_URL: "https://example.com/privacy" };
    const summary = await runYoutubeTrendDiscoveryWorker({ workerId: "worker", repository, fetchImpl: fetchImpl as typeof fetch, env, now: () => NOW });
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({ code: "YOUTUBE_API_CREDENTIALS_INVALID", kind: "permanent" });
    expect(summary).toMatchObject({ claimed: 1, failedKnown: 1, retried: 0 });
  });
});
