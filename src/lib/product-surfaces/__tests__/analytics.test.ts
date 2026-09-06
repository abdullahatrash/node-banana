import { describe, expect, it } from "vitest";
import { buildAnalyticsSeries } from "../analytics";
import { PRODUCT_RECORD_KINDS, parseProductPayload } from "../definitions";

describe("analytics sources", () => {
  it("supports explicit Website and GEO configurations", () => { expect(PRODUCT_RECORD_KINDS).toContain("website_analytics_source"); expect(PRODUCT_RECORD_KINDS).toContain("geo_analytics_source"); expect(() => parseProductPayload("geo_analytics_source", { domain: "example.com", topics: ["Arabic commerce"], enabled: true, lastObservationAt: null })).not.toThrow(); });

  it("keeps missing observations unknown in daily mode and accumulates only known evidence", () => {
    const from = new Date("2026-09-01T12:00:00.000Z");
    const posts = [{ createdAt: new Date("2026-09-02T13:00:00.000Z") }, { createdAt: new Date("2026-09-03T13:00:00.000Z") }];
    const events = [{ createdAt: new Date("2026-09-02T13:00:00.000Z"), metadata: { views: 3 } }];
    const observations = [{ windowEndedAt: new Date("2026-09-03T13:00:00.000Z"), metric: "websiteViews", value: 1 }];
    expect(buildAnalyticsSeries({ days: 2, from, posts, events, observations, mode: "daily" })).toEqual([
      { date: "2026-09-02", posts: 1, views: 3, websiteViews: null },
      { date: "2026-09-03", posts: 1, views: null, websiteViews: 1 },
    ]);
    expect(buildAnalyticsSeries({ days: 2, from, posts, events, observations, mode: "cumulative" })).toEqual([
      { date: "2026-09-02", posts: 1, views: 3, websiteViews: null },
      { date: "2026-09-03", posts: 2, views: 3, websiteViews: 1 },
    ]);
  });
});
