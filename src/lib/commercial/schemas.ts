import { z } from "zod";
const id = z.string().trim().min(1).max(200); const digest = z.string().regex(/^sha256:[a-f0-9]{64}$/); const date = z.string().datetime();
export const publicCommercialCommandSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("start_trial"), planId: id, planVersion: z.number().int().positive(), idempotencyKey: id }),
  z.object({ action: z.literal("accept_quote"), quoteId: id, idempotencyKey: id }),
  z.object({ action: z.literal("create_referral_code"), rewardMode: z.enum(["generation_credit", "cash"]), idempotencyKey: id }),
]);
export const internalCommercialCommandSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("publish_plan"), planId: id, version: z.number().int().positive(), authoredName: z.object({ ar: id, en: id }), currency: z.string().regex(/^[A-Z]{3}$/), priceMinor: z.number().int().nonnegative(), billingInterval: z.enum(["month", "year", "one_time"]), taxMode: z.enum(["inclusive", "exclusive"]), trialDays: z.number().int().min(0).max(90), trialCreditUnits: z.number().int().nonnegative(), entitlements: z.record(z.string(), z.union([z.number().nonnegative(), z.boolean()])), termsDigest: digest, effectiveAt: date }),
  z.object({ action: z.literal("issue_quote"), workspaceId: id, purposeRef: id, maxCreditDebit: z.number().int().positive(), pricingSnapshotDigest: digest, expiresAt: date, localPriceMinor: z.number().int().nonnegative().nullable(), currency: z.string().regex(/^[A-Z]{3}$/).nullable(), taxMinor: z.number().int().nonnegative().nullable(), idempotencyKey: id }),
  z.object({ action: z.literal("reserve_quote"), workspaceId: id, quoteId: id, externalEffectRef: id.nullable(), idempotencyKey: id }),
  z.object({ action: z.literal("settle_reservation"), workspaceId: id, reservationId: id, outcome: z.enum(["succeeded", "failed_known", "outcome_unknown"]), actualDebitUnits: z.number().int().nonnegative().nullable(), idempotencyKey: id }),
  z.object({ action: z.literal("grant_purchased_credits"), workspaceId: id, merchantReceiptRef: id, units: z.number().int().positive(), idempotencyKey: id }),
  z.object({ action: z.literal("attribute_referral"), code: z.string().regex(/^[A-Z0-9-]{6,32}$/), referredIdentityDigest: digest, referredWorkspaceId: id.nullable(), attributionDigest: digest, idempotencyKey: id }),
  z.object({ action: z.literal("decide_referral"), attributionId: id, decision: z.enum(["clear", "hold", "reject"]), policyVersion: id, evidenceDigest: digest, reviewerRef: id, creditUnits: z.number().int().positive().nullable(), cashMinor: z.number().int().positive().nullable(), currency: z.string().regex(/^[A-Z]{3}$/).nullable(), thresholdMinor: z.number().int().nonnegative().nullable(), idempotencyKey: id }),
  z.object({ action: z.literal("transition_subscription"), workspaceId: id, expectedRevision: z.number().int().positive(), toState: z.enum(["active", "past_due", "grace", "cancel_at_period_end", "cancelled", "suspended"]), reasonCode: z.string().regex(/^[a-z][a-z0-9_.-]{2,99}$/), periodEndsAt: date, graceEndsAt: date.nullable(), merchantCustomerRef: id.nullable(), merchantSubscriptionRef: id.nullable(), idempotencyKey: id }),
]);
