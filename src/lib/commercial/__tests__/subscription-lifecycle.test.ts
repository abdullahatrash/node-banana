import { describe, expect, it } from "vitest";
import type { MerchantSubscriptionEvent } from "../merchant";
import { subscriptionLifecycleProjection } from "../subscription-lifecycle";

const current = {
  currentPeriodStartsAt: new Date("2026-09-01T00:00:00.000Z"),
  currentPeriodEndsAt: new Date("2026-10-01T00:00:00.000Z"),
  merchantLastEventAt: new Date("2026-09-05T12:00:00.000Z"),
  merchantLastEventId: "evt_b",
};
const base: MerchantSubscriptionEvent = {
  provider: "paddle", eventId: "evt_c", eventType: "subscription.active", workspaceId: "workspace_1", merchantCustomerRef: "ctm_1", merchantSubscriptionRef: "sub_1", merchantTransactionRef: null, periodStartsAt: null, periodEndsAt: null, occurredAt: new Date("2026-09-05T12:00:01.000Z"),
};

describe("subscriptionLifecycleProjection", () => {
  it("orders provider events by occurred-at and event ID for deterministic replay", () => {
    expect(subscriptionLifecycleProjection(current, base, 7).stale).toBe(false);
    expect(subscriptionLifecycleProjection(current, { ...base, eventId: "evt_a", occurredAt: current.merchantLastEventAt! }, 7).stale).toBe(true);
    expect(subscriptionLifecycleProjection(current, { ...base, occurredAt: new Date("2026-09-05T11:59:59.000Z") }, 7).stale).toBe(true);
  });

  it("maps failed payment to a bounded grace window without changing its paid period", () => {
    const projection = subscriptionLifecycleProjection(current, { ...base, eventType: "subscription.grace", occurredAt: new Date("2026-10-02T00:00:00.000Z") }, 7);
    expect(projection.target).toBe("grace");
    expect(projection.periodEndsAt).toEqual(current.currentPeriodEndsAt);
    expect(projection.graceEndsAt).toEqual(new Date("2026-10-09T00:00:00.000Z"));
  });

  it("uses the paid renewal period and restores active state", () => {
    const projection = subscriptionLifecycleProjection(current, { ...base, eventType: "subscription.payment_completed", merchantTransactionRef: "txn_2", periodStartsAt: new Date("2026-10-01T00:00:00.000Z"), periodEndsAt: new Date("2026-11-01T00:00:00.000Z") }, 7);
    expect(projection).toMatchObject({ target: "active", periodStartsAt: new Date("2026-10-01T00:00:00.000Z"), periodEndsAt: new Date("2026-11-01T00:00:00.000Z"), graceEndsAt: null });
  });

  it("rejects an invalid provider period", () => {
    expect(() => subscriptionLifecycleProjection(current, { ...base, periodStartsAt: new Date("2026-11-01T00:00:00.000Z"), periodEndsAt: new Date("2026-10-01T00:00:00.000Z") }, 7)).toThrow("SUBSCRIPTION_PERIOD_INVALID");
  });
});
