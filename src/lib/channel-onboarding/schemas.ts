import { z } from "zod";
import { CHANNEL_ONBOARDING_STATES } from "./types";

const id = z.string().trim().min(1).max(200);
const digest = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const date = z.string().datetime();
const platform = z.enum(["x", "linkedin", "instagram", "tiktok", "threads", "pinterest", "facebook", "youtube", "reddit", "bluesky", "mastodon"]);

export const publicChannelOnboardingCommandSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create_order"), offerId: id, offerVersion: z.number().int().positive(), region: z.string().regex(/^[A-Z]{2}$/), compliancePolicyAccepted: z.literal(true), idempotencyKey: id }),
  z.object({ action: z.literal("accept_quote"), orderId: id, expectedRevision: z.number().int().positive(), idempotencyKey: id }),
  z.object({ action: z.literal("bind_credential"), orderId: id, expectedRevision: z.number().int().positive(), credentialProfileId: id, idempotencyKey: id }),
  z.object({ action: z.literal("complete_customer_task"), orderId: id, taskId: id, expectedRevision: z.number().int().positive(), evidenceNote: z.string().trim().min(1).max(2_000), idempotencyKey: id }),
  z.object({ action: z.literal("connect_channel"), orderId: id, expectedRevision: z.number().int().positive(), socialAccountId: id, idempotencyKey: id }),
  z.object({ action: z.literal("cancel"), orderId: id, expectedRevision: z.number().int().positive(), reasonCode: z.string().regex(/^[a-z][a-z0-9_.-]{2,99}$/), idempotencyKey: id }),
]);

export const internalChannelOnboardingCommandSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("publish_offer"), offerId: id, version: z.number().int().positive(), platform, authoredName: z.object({ ar: id, en: id }), authoredDescription: z.object({ ar: id, en: id }), supportedRegions: z.array(z.string().regex(/^[A-Z]{2}$/)).min(1).max(50), customerRequirements: z.array(z.object({ key: z.string().regex(/^[a-z][a-z0-9_.-]{1,99}$/), label: z.object({ ar: id, en: id }).strict(), instructions: z.object({ ar: id, en: id }).strict(), required: z.boolean() }).strict()).min(1).max(50), maxPartnerHours: z.number().int().min(0).max(100), localPriceMinor: z.number().int().nonnegative(), currency: z.string().regex(/^[A-Z]{3}$/), taxMode: z.literal("inclusive"), termsDigest: digest, compliancePolicyVersion: id, effectiveAt: date }),
  z.object({ action: z.literal("publish_partner"), partnerId: id, legalName: id, supportedPlatforms: z.array(platform).min(1), supportedRegions: z.array(z.string().regex(/^[A-Z]{2}$/)).min(1), vettingDigest: digest, policyVersion: id, effectiveAt: date, expiresAt: date }),
  z.object({ action: z.literal("confirm_payment"), workspaceId: id, orderId: id, expectedRevision: z.number().int().positive(), merchantReceiptRef: id, idempotencyKey: id }),
  z.object({ action: z.literal("assign_partner"), workspaceId: id, orderId: id, expectedRevision: z.number().int().positive(), partnerId: id, purpose: z.enum(["guided_setup", "readiness_review", "support"]), permittedActions: z.array(id).min(1).max(20), expiresAt: date, assignedByUserId: id.nullable(), taskKind: id, taskInstructions: z.object({ ar: id, en: id }), taskDueAt: date.nullable(), idempotencyKey: id }),
  z.object({ action: z.literal("create_customer_task"), workspaceId: id, orderId: id, expectedRevision: z.number().int().positive(), taskKind: id, taskInstructions: z.object({ ar: id, en: id }), taskDueAt: date.nullable(), idempotencyKey: id }),
  z.object({ action: z.literal("complete_partner_task"), workspaceId: id, orderId: id, taskId: id, assignmentId: id, expectedRevision: z.number().int().positive(), evidenceDigest: digest, idempotencyKey: id }),
  z.object({ action: z.literal("readiness_review"), workspaceId: id, orderId: id, expectedRevision: z.number().int().positive(), decision: z.enum(["ready", "customer_action", "partner_action", "blocked"]), checklist: z.record(z.string(), z.boolean()), evidenceDigest: digest, reviewerRef: id, idempotencyKey: id }),
  z.object({ action: z.literal("record_refund"), workspaceId: id, orderId: id, expectedRevision: z.number().int().positive(), merchantRefundRef: id, idempotencyKey: id }),
  z.object({ action: z.literal("set_state"), workspaceId: id, orderId: id, expectedRevision: z.number().int().positive(), state: z.enum(CHANNEL_ONBOARDING_STATES), reasonCode: z.string().regex(/^[a-z][a-z0-9_.-]{2,99}$/), idempotencyKey: id }),
]);
