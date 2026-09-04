import { describe, expect, it } from "vitest";
import { trendFeedFiltersSchema, trendFreshness } from "../trend-feed";

describe("inspiration trend discovery boundary", () => {
  it("accepts MENA, Arabic, format, rights, and Blitz filters but never restricted rights", () => {
    expect(trendFeedFiltersSchema.parse({ region: "GCC", language: "ar", arabicVariety: "gulf", format: "video_hook_demo", rightsStatus: "licensed", blitzReady: true })).toMatchObject({ region: "GCC", language: "ar", arabicVariety: "gulf", rightsStatus: "licensed", blitzReady: true });
    expect(() => trendFeedFiltersSchema.parse({ rightsStatus: "restricted" })).toThrow();
    expect(() => trendFeedFiltersSchema.parse({ limit: 101 })).toThrow();
  });

  it("classifies visible freshness from the exact metrics observation time", () => {
    const at = new Date("2026-09-04T12:00:00.000Z");
    expect(trendFreshness(new Date("2026-09-04T00:00:00.000Z"), at)).toBe("live");
    expect(trendFreshness(new Date("2026-09-01T00:00:00.000Z"), at)).toBe("recent");
    expect(trendFreshness(new Date("2026-08-01T00:00:00.000Z"), at)).toBe("aging");
  });
});
