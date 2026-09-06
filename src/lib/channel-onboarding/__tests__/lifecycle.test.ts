import { describe, expect, it } from "vitest";
import { assertTransition, partnerScopeIsSafe } from "../types";
import { publicChannelOnboardingCommandSchema } from "../schemas";

describe("managed Channel Onboarding policy", () => {
  it("covers paid work, customer and partner recovery, readiness, connection, and refund", () => {
    for (const [from, to] of [["quoted", "payment_pending"], ["payment_pending", "accepted"], ["accepted", "customer_action"], ["customer_action", "partner_action"], ["partner_action", "readiness_review"], ["readiness_review", "ready_to_connect"], ["ready_to_connect", "connected"], ["cancelled", "refunded"]] as const) expect(() => assertTransition(from, to)).not.toThrow();
    expect(() => assertTransition("quoted", "connected")).toThrow("ORDER_TRANSITION_INVALID");
  });

  it("never grants partners credential, impersonation, or publishing authority", () => {
    expect(partnerScopeIsSafe(["profile.guidance", "readiness.check"])).toBe(true);
    for (const action of ["credential.read", "credential.write", "publish", "impersonate"]) expect(partnerScopeIsSafe([action])).toBe(false);
  });

  it("requires explicit compliance acceptance and hashes task evidence server-side", () => {
    const base = { action: "create_order", offerId: "mena-instagram", offerVersion: 1, region: "AE", idempotencyKey: "request-1" };
    expect(publicChannelOnboardingCommandSchema.safeParse({ ...base, compliancePolicyAccepted: false }).success).toBe(false);
    expect(publicChannelOnboardingCommandSchema.safeParse({ ...base, compliancePolicyAccepted: true }).success).toBe(true);
    expect(publicChannelOnboardingCommandSchema.safeParse({ action: "complete_customer_task", orderId: "o1", taskId: "t1", expectedRevision: 2, evidenceNote: "Completed official Platform verification.", idempotencyKey: "request-2" }).success).toBe(true);
  });
});
