import { describe, expect, it } from "vitest";
import { chooseDashboardNextAction } from "../dashboard-policy";

describe("dashboard next action", () => {
  it("uses a deterministic, inspectable priority order", () => {
    const input = { brand: false, media: 0, channels: 0, reauth: 1, failedPublishing: 3, failedGeneration: 2, consentAttention: 1, pendingApprovals: 1, acceptedContent: 0, scheduled: 0, creditCapacity: "depleted" as const, metricsStale: true };
    expect(chooseDashboardNextAction(input).key).toBe("brand");
    expect(chooseDashboardNextAction({ ...input, brand: true }).key).toBe("media");
    expect(chooseDashboardNextAction({ ...input, brand: true, media: 1 }).key).toBe("channel");
    expect(chooseDashboardNextAction({ ...input, brand: true, media: 1, channels: 1 }).key).toBe("reauth");
    expect(chooseDashboardNextAction({ ...input, brand: true, media: 1, channels: 1, reauth: 0 }).key).toBe("publishingFailure");
    expect(chooseDashboardNextAction({ ...input, brand: true, media: 1, channels: 1, reauth: 0, failedPublishing: 0 }).key).toBe("generationFailure");
    expect(chooseDashboardNextAction({ ...input, brand: true, media: 1, channels: 1, reauth: 0, failedPublishing: 0, failedGeneration: 0 }).key).toBe("consent");
    expect(chooseDashboardNextAction({ ...input, brand: true, media: 1, channels: 1, reauth: 0, failedPublishing: 0, failedGeneration: 0, consentAttention: 0 }).key).toBe("approval");
    expect(chooseDashboardNextAction({ ...input, brand: true, media: 1, channels: 1, reauth: 0, failedPublishing: 0, failedGeneration: 0, consentAttention: 0, pendingApprovals: 0 }).key).toBe("content");
    expect(chooseDashboardNextAction({ ...input, brand: true, media: 1, channels: 1, reauth: 0, failedPublishing: 0, failedGeneration: 0, consentAttention: 0, pendingApprovals: 0, acceptedContent: 1 }).key).toBe("schedule");
    expect(chooseDashboardNextAction({ ...input, brand: true, media: 1, channels: 1, reauth: 0, failedPublishing: 0, failedGeneration: 0, consentAttention: 0, pendingApprovals: 0, acceptedContent: 1, scheduled: 1 }).key).toBe("credits");
    expect(chooseDashboardNextAction({ ...input, brand: true, media: 1, channels: 1, reauth: 0, failedPublishing: 0, failedGeneration: 0, consentAttention: 0, pendingApprovals: 0, acceptedContent: 1, scheduled: 1, creditCapacity: "available" }).key).toBe("metrics");
    expect(chooseDashboardNextAction({ ...input, brand: true, media: 1, channels: 1, reauth: 0, failedPublishing: 0, failedGeneration: 0, consentAttention: 0, pendingApprovals: 0, acceptedContent: 1, scheduled: 1, creditCapacity: "unavailable", metricsStale: false }).key).toBe("insights");
  });
});
