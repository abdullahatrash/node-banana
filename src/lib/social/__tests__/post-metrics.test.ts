import { describe, expect, it } from "vitest";
import { normalizedMetrics, parseProviderCount, validatePostMetricIds } from "../post-metrics";

describe("social post metrics contract", () => {
  it("accepts safe integer counts while preserving unavailable fields", () => {
    expect(normalizedMetrics({ views: "12000", likes: 900, comments: null })).toEqual({ views: 12_000, likes: 900, comments: null, shares: null });
    expect(parseProviderCount(undefined)).toBeNull();
  });

  it("rejects fractional, negative, overflowing, and malformed counts", () => {
    for (const value of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, "1.5", "-1", "12k"]) {
      expect(() => parseProviderCount(value)).toThrow("SOCIAL_POST_METRIC_INVALID");
    }
  });

  it("enforces bounded, unique, provider-safe post IDs", () => {
    expect(validatePostMetricIds(["post_1", "post:2"], 2)).toEqual(["post_1", "post:2"]);
    expect(() => validatePostMetricIds([], 20)).toThrow("SOCIAL_POST_METRICS_BATCH_INVALID");
    expect(() => validatePostMetricIds(["same", "same"], 20)).toThrow("SOCIAL_POST_METRICS_IDS_INVALID");
    expect(() => validatePostMetricIds(["bad/id"], 20)).toThrow("SOCIAL_POST_METRICS_IDS_INVALID");
  });
});
