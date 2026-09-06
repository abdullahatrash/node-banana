import { describe, expect, it } from "vitest";
import {
  InMemoryOnboardingAnalytics,
  ONBOARDING_EVENT_NAMES,
  onboardingAnalyticsEventSchema,
  recordOnboardingEventBestEffort,
} from "../analytics";

describe("onboarding analytics", () => {
  it("accepts only bounded, privacy-safe funnel properties", async () => {
    const analytics = new InMemoryOnboardingAnalytics();
    await analytics.record({
      eventName: "analysis_failed",
      workspaceId: "workspace_1",
      runId: "run_1",
      stage: "generating_profile",
      durationMs: 1200,
      failureCode: "BRAND_PROFILE_OUTPUT_INVALID",
      contentLanguage: "ar-SA",
      occurredAt: new Date("2026-08-31T12:00:00.000Z"),
    });

    expect(analytics.events).toHaveLength(1);
    expect(analytics.events[0]).not.toHaveProperty("description");
    expect(analytics.events[0]).not.toHaveProperty("url");
  });

  it("rejects arbitrary payloads and sensitive source fields", () => {
    expect(
      onboardingAnalyticsEventSchema.safeParse({
        eventName: "source_selected",
        sourceKind: "website",
        sourceBody: "private company description",
        occurredAt: new Date(),
      }).success,
    ).toBe(false);
    expect(ONBOARDING_EVENT_NAMES).toContain("first_value_viewed");
  });

  it("never lets an analytics outage replace the canonical result", async () => {
    await expect(
      recordOnboardingEventBestEffort(
        { record: async () => { throw new Error("analytics unavailable"); } },
        { eventName: "step_viewed", step: "identity", occurredAt: new Date() },
      ),
    ).resolves.toBeUndefined();
  });
});
