import { describe, expect, it } from "vitest";
import { resolveWorkspaceChannelEntitlement } from "../channel-entitlement";

const now = new Date("2026-09-04T12:00:00.000Z");
const base = {
  planId: "growth",
  planVersion: 4,
  subscriptionState: "active",
  currentPeriodEndsAt: new Date("2026-10-01T00:00:00.000Z"),
  graceEndsAt: null,
  authoredName: { ar: "النمو", en: "Growth" },
  entitlements: {
    generationCreditsPerPeriod: 500,
    workspaceSeats: 10,
    connectedChannels: 15,
    activeAutomations: 15,
    apiAccess: true,
    creatorPersonas: true,
    managedChannelOnboarding: true,
  },
};

describe("workspace Channel entitlement", () => {
  it("reads the immutable subscription plan version instead of a legacy tier", () => {
    expect(resolveWorkspaceChannelEntitlement(base, now)).toEqual({
      planId: "growth",
      planVersion: 4,
      subscriptionState: "active",
      authoredName: { ar: "النمو", en: "Growth" },
      connectedChannels: 15,
    });
  });

  it("keeps current grace access and fails closed for expired or malformed terms", () => {
    expect(resolveWorkspaceChannelEntitlement({
      ...base,
      subscriptionState: "grace",
      currentPeriodEndsAt: new Date("2026-09-01T00:00:00.000Z"),
      graceEndsAt: new Date("2026-09-10T00:00:00.000Z"),
    }, now).connectedChannels).toBe(15);
    expect(resolveWorkspaceChannelEntitlement({ ...base, currentPeriodEndsAt: new Date("2026-09-01T00:00:00.000Z") }, now).connectedChannels).toBe(0);
    expect(() => resolveWorkspaceChannelEntitlement({ ...base, entitlements: { ...base.entitlements, connectedChannels: -1 } }, now)).toThrow("PLAN_ENTITLEMENTS_INVALID");
  });

  it("uses the published Free v1 terms only when no subscription exists", () => {
    expect(resolveWorkspaceChannelEntitlement(null, now)).toMatchObject({
      planId: "free",
      planVersion: 1,
      connectedChannels: 2,
    });
  });
});
