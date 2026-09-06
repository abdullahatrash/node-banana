import { describe, expect, it } from "vitest";
import { allocateCredits, SUBSCRIPTION_TRANSITIONS } from "../types";
const at = new Date("2026-09-04T00:00:00Z");
describe("commercial credit accounting", () => {
  it("consumes expiring allowance before purchased and referral balances", () => {
    const result = allocateCredits({ requiredUnits: 100, at, buckets: [
      { id: "purchase", kind: "purchased", availableUnits: 100, expiresAt: null, createdAt: at },
      { id: "later", kind: "allowance", availableUnits: 50, expiresAt: new Date("2026-10-01T00:00:00Z"), createdAt: at },
      { id: "soon", kind: "allowance", availableUnits: 40, expiresAt: new Date("2026-09-10T00:00:00Z"), createdAt: at },
      { id: "referral", kind: "referral", availableUnits: 100, expiresAt: null, createdAt: at },
    ] });
    expect(result).toMatchObject({ kind: "allocated", allocations: [{ bucketId: "soon", units: 40 }, { bucketId: "later", units: 50 }, { bucketId: "purchase", units: 10 }] });
  });
  it("never partially reserves insufficient credit", () => expect(allocateCredits({ requiredUnits: 6, at, buckets: [{ id: "one", kind: "allowance", availableUnits: 5, expiresAt: new Date("2026-09-05T00:00:00Z"), createdAt: at }] })).toEqual({ kind: "insufficient", requiredUnits: 6, availableUnits: 5 }));
  it("keeps cancellation, grace, suspension, and recovery explicit", () => { expect(SUBSCRIPTION_TRANSITIONS.active).toContain("cancel_at_period_end"); expect(SUBSCRIPTION_TRANSITIONS.past_due).toContain("grace"); expect(SUBSCRIPTION_TRANSITIONS.suspended).toEqual(["active", "cancelled"]); });
});
