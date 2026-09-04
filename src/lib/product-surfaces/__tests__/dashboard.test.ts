import { describe, expect, it } from "vitest";
import { chooseDashboardNextAction } from "../dashboard-policy";

describe("dashboard next action", () => {
  it("uses a deterministic, inspectable priority order", () => {
    const input = { brand: false, media: 0, channels: 0, failedPublishing: 3, content: 0, scheduled: 0 };
    expect(chooseDashboardNextAction(input).key).toBe("brand");
    expect(chooseDashboardNextAction({ ...input, brand: true }).key).toBe("media");
    expect(chooseDashboardNextAction({ ...input, brand: true, media: 1 }).key).toBe("channel");
    expect(chooseDashboardNextAction({ ...input, brand: true, media: 1, channels: 1 }).key).toBe("failure");
    expect(chooseDashboardNextAction({ ...input, brand: true, media: 1, channels: 1, failedPublishing: 0 }).key).toBe("content");
    expect(chooseDashboardNextAction({ ...input, brand: true, media: 1, channels: 1, failedPublishing: 0, content: 1 }).key).toBe("schedule");
    expect(chooseDashboardNextAction({ ...input, brand: true, media: 1, channels: 1, failedPublishing: 0, content: 1, scheduled: 1 }).key).toBe("insights");
  });
});
