import { describe, expect, it } from "vitest";
import { rankTrendCandidate } from "../trend-ranking";
import type { TrendIngestionCandidate, TrendRankingContext } from "../trend-types";

const now = new Date("2026-09-04T12:00:00.000Z");
const candidate: TrendIngestionCandidate = {
  externalItemId: "official-gulf-launch-1",
  title: "إطلاق منتج تقني للشركات الخليجية",
  sourceUrl: "https://example.com/trends/gulf-launch-1",
  sourceName: "Licensed MENA Trends",
  sourcePublishedAt: "2026-09-04T06:00:00.000Z",
  sourceContentDigest: `sha256:${"a".repeat(64)}`,
  metricsObservedAt: "2026-09-04T11:30:00.000Z",
  metrics: { views: 1_000_000, likes: 80_000 },
  region: "GCC",
  contentLanguage: "ar",
  arabicVariety: "gulf",
  format: "video_hook_demo",
  tags: ["تقنية", "شركات", "إطلاق"],
  rights: {
    status: "licensed",
    evidenceRef: "license:mena-dataset:2026",
    evidenceDigest: `sha256:${"b".repeat(64)}`,
    observedAt: "2026-09-04T11:30:00.000Z",
    expiresAt: "2027-09-04T00:00:00.000Z",
    sourceAssetId: "asset-1",
    rightsSnapshot: { id: "rights-1", revision: 2, digest: `sha256:${"c".repeat(64)}` },
    permittedInfluence: ["topic", "hook", "pacing", "structure"],
  },
};
const context: TrendRankingContext = {
  brandProfile: { id: "brand-1", revision: 4, digest: `sha256:${"d".repeat(64)}`, contentLanguage: "ar", keywords: ["تقنية", "شركات", "منتج"] },
  preferredRegions: ["GCC"],
  preferredArabicVarieties: ["gulf"],
  preferredFormats: ["video_hook_demo"],
  preferredTags: ["إطلاق"],
  excludedTags: [],
};

describe("explainable trend ranking", () => {
  it("ranks fresh, high-performing, Arabic Gulf evidence against the pinned Brand revision", () => {
    const result = rankTrendCandidate({ candidate, context, evaluatedAt: now });

    expect(result.score).toBe(10_000);
    expect(result.signals).toEqual({
      freshness: 100, recency: 100, performance: 100, brandFit: 100,
      region: 100, language: 100, arabicVariety: 100, format: 100,
      rights: 100, preference: 100,
    });
    expect(result.reasonCodes).toEqual([
      "fresh_metrics", "recent_source", "strong_performance", "brand_topic_match",
      "mena_region_match", "content_language_match", "arabic_variety_match",
      "preferred_format", "licensed_rights", "explicit_preference_match",
    ]);
    expect(result.brandProfile).toEqual({ id: "brand-1", revision: 4, digest: `sha256:${"d".repeat(64)}` });
    expect(result.digest).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it("fails closed for restricted evidence and visibly penalizes stale or excluded material", () => {
    const result = rankTrendCandidate({
      candidate: {
        ...candidate,
        sourcePublishedAt: "2025-01-01T00:00:00.000Z",
        metricsObservedAt: "2025-01-01T00:00:00.000Z",
        tags: ["gambling"],
        rights: { ...candidate.rights, status: "restricted", sourceAssetId: null, rightsSnapshot: null },
      },
      context: { ...context, excludedTags: ["gambling"] },
      evaluatedAt: now,
    });

    expect(result.eligibleForDiscovery).toBe(false);
    expect(result.eligibleForBlitz).toBe(false);
    expect(result.signals.freshness).toBe(0);
    expect(result.signals.rights).toBe(0);
    expect(result.reasonCodes).toContain("rights_restricted");
    expect(result.reasonCodes).toContain("explicit_preference_excluded");
  });

  it("keeps metadata-only trends discoverable but never admits them to Blitz", () => {
    const result = rankTrendCandidate({
      candidate: { ...candidate, rights: { ...candidate.rights, status: "metadata_only", sourceAssetId: null, rightsSnapshot: null, permittedInfluence: ["topic"] } },
      context,
      evaluatedAt: now,
    });

    expect(result.eligibleForDiscovery).toBe(true);
    expect(result.eligibleForBlitz).toBe(false);
    expect(result.reasonCodes).toContain("metadata_only_rights");
  });
});
