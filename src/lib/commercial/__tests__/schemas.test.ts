import { describe, expect, it } from "vitest";
import { internalCommercialCommandSchema } from "../schemas";

describe("internal commercial command idempotency", () => {
  const digest = `sha256:${"a".repeat(64)}`;
  const commands = [
    { action: "issue_quote", workspaceId: "ws", purposeRef: "generation:intent", maxCreditDebit: 4, pricingSnapshotDigest: digest, expiresAt: "2026-09-05T00:00:00.000Z", localPriceMinor: null, currency: null, taxMinor: null },
    { action: "reserve_quote", workspaceId: "ws", quoteId: "quote", externalEffectRef: "intent" },
    { action: "settle_reservation", workspaceId: "ws", reservationId: "reservation", outcome: "failed_known", actualDebitUnits: null },
    { action: "grant_purchased_credits", workspaceId: "ws", merchantReceiptRef: "receipt", units: 10 },
    { action: "attribute_referral", code: "ABCDEF", referredIdentityDigest: digest, referredWorkspaceId: "referred", attributionDigest: digest },
    { action: "decide_referral", attributionId: "attribution", decision: "hold", policyVersion: "v1", evidenceDigest: digest, reviewerRef: "reviewer", creditUnits: null, cashMinor: null, currency: null, thresholdMinor: null },
    { action: "transition_subscription", workspaceId: "ws", expectedRevision: 1, toState: "active", reasonCode: "merchant.confirmed", periodEndsAt: "2026-10-05T00:00:00.000Z", graceEndsAt: null, merchantCustomerRef: "customer", merchantSubscriptionRef: "subscription" },
  ] as const;

  it.each(commands)("requires an idempotency key for $action", (command) => {
    expect(internalCommercialCommandSchema.safeParse(command).success).toBe(false);
    expect(internalCommercialCommandSchema.safeParse({ ...command, idempotencyKey: `internal:${command.action}:event-1` }).success).toBe(true);
  });
});
