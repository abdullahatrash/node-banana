import { describe, expect, it } from "vitest";
import {
  CommercialEntitlementError,
  resolveWorkspaceCommercialEntitlements,
} from "../entitlements";

const at = new Date("2026-09-05T12:00:00.000Z");
const entitlements = {
  generationCreditsPerPeriod: 500,
  workspaceSeats: 10,
  connectedChannels: 15,
  activeAutomations: 15,
  apiAccess: true,
  creatorPersonas: true,
  managedChannelOnboarding: true,
};

const row = {
  planId: "growth",
  planVersion: 1,
  subscriptionState: "active",
  currentPeriodEndsAt: new Date("2026-10-01T00:00:00.000Z"),
  graceEndsAt: null,
  authoredName: { ar: "النمو", en: "Growth" },
  entitlements,
};

describe("workspace commercial entitlements", () => {
  it("projects an active immutable plan version", () => {
    expect(resolveWorkspaceCommercialEntitlements(row, at)).toMatchObject({
      planId: "growth",
      planVersion: 1,
      grantsAccess: true,
      entitlements,
    });
  });

  it("honors a current grace period and denies an expired one", () => {
    const grace = { ...row, subscriptionState: "grace", currentPeriodEndsAt: new Date("2026-09-01T00:00:00.000Z"), graceEndsAt: new Date("2026-09-06T00:00:00.000Z") };
    expect(resolveWorkspaceCommercialEntitlements(grace, at).grantsAccess).toBe(true);
    expect(resolveWorkspaceCommercialEntitlements({ ...grace, graceEndsAt: new Date("2026-09-05T00:00:00.000Z") }, at)).toMatchObject({
      grantsAccess: false,
      entitlements: { workspaceSeats: 0, connectedChannels: 0, activeAutomations: 0, apiAccess: false },
    });
  });

  it("falls back to the published free terms only when no subscription exists", () => {
    expect(resolveWorkspaceCommercialEntitlements(null, at)).toMatchObject({
      planId: "free",
      planVersion: 1,
      grantsAccess: true,
      entitlements: { generationCreditsPerPeriod: 10, workspaceSeats: 1, connectedChannels: 2 },
    });
  });

  it("fails closed when persisted terms do not match the contract", () => {
    expect(() => resolveWorkspaceCommercialEntitlements({ ...row, entitlements: { apiAccess: true } }, at)).toThrowError(
      new CommercialEntitlementError("PLAN_ENTITLEMENTS_INVALID"),
    );
  });
});
