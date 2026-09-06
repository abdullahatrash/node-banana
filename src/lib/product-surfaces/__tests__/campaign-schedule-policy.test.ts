import { describe, expect, it } from "vitest";
import { planCampaignOccurrences } from "../campaign-schedule-policy";

describe("campaign occurrence scheduling", () => {
  it("pins deterministic keys to the immutable revision and Workspace timezone", () => {
    const input = { campaignId: "campaign", campaignRevision: 7, cadence: { timezone: "Asia/Riyadh", weekStart: 0, postsPerWeek: 3, startAt: null, endAt: null }, formatMix: { slideshow: 50, wall_of_text: 50 }, from: new Date("2026-09-06T00:00:00Z"), through: new Date("2026-09-13T23:59:59Z") } as const;
    const first = planCampaignOccurrences(input); const replay = planCampaignOccurrences(input);
    expect(first).toEqual(replay); expect(first.length).toBeGreaterThanOrEqual(3);
    expect(first.every((plan) => plan.occurrenceKey.startsWith("campaign-occurrence:"))).toBe(true);
    expect(first.map((plan) => plan.format)).toEqual(first.map((_, index) => index % 2 ? "wall_of_text" : "slideshow"));
  });

  it("bounds the horizon and validates timezone/week-start", () => {
    const common = { campaignId: "c", campaignRevision: 1, formatMix: { slideshow: 100 }, from: new Date("2026-09-01T00:00:00Z"), through: new Date("2027-09-01T00:00:00Z") };
    const plans = planCampaignOccurrences({ ...common, cadence: { timezone: "Africa/Cairo", weekStart: 6, postsPerWeek: 100, startAt: null, endAt: null }, maximumHorizonDays: 7 });
    expect(plans.length).toBeLessThanOrEqual(100);
    expect(() => planCampaignOccurrences({ ...common, cadence: { timezone: "Not/AZone", weekStart: 1, postsPerWeek: 1, startAt: null, endAt: null } })).toThrow("CAMPAIGN_TIMEZONE_INVALID");
  });
});
