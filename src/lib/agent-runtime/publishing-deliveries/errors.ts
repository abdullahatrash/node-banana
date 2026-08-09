import type { CapabilityErrorContract } from "@/types/capabilities";

export type PublishingDeliveryServiceErrorCode =
  | "PUBLISHING_DELIVERY_INVALID_INPUT"
  | "PUBLISHING_DELIVERY_NOT_FOUND"
  | "PUBLISHING_DELIVERY_IDEMPOTENCY_CONFLICT"
  | "PUBLISHING_DELIVERY_APPROVAL_INVALID"
  | "PUBLISHING_DELIVERY_APPROVAL_CONSUMED"
  | "PUBLISHING_DELIVERY_STALE_REVISION"
  | "PUBLISHING_DELIVERY_AUTHORIZATION_STALE"
  | "PUBLISHING_DELIVERY_CANCELLATION_NOT_AUTHORIZED"
  | "PUBLISHING_DELIVERY_RECOVERY_NOT_AUTHORIZED"
  | "PUBLISHING_DELIVERY_RETRY_NOT_SAFE"
  | "PUBLISHING_DELIVERY_RECONCILIATION_NOT_AVAILABLE"
  | "PUBLISHING_DELIVERY_VALIDATION_STALE"
  | "PUBLISHING_DELIVERY_PERSISTENCE_UNAVAILABLE";

export class PublishingDeliveryServiceError extends Error {
  constructor(
    readonly code: PublishingDeliveryServiceErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "PublishingDeliveryServiceError";
  }
}

export const PUBLISHING_DELIVERY_ERROR_CATALOG: Record<
  PublishingDeliveryServiceErrorCode,
  { category: CapabilityErrorContract["category"]; retryable: boolean }
> = {
  PUBLISHING_DELIVERY_INVALID_INPUT: { category: "validation", retryable: false },
  PUBLISHING_DELIVERY_NOT_FOUND: { category: "not_found", retryable: false },
  PUBLISHING_DELIVERY_IDEMPOTENCY_CONFLICT: { category: "conflict", retryable: false },
  PUBLISHING_DELIVERY_APPROVAL_INVALID: { category: "approval", retryable: false },
  PUBLISHING_DELIVERY_APPROVAL_CONSUMED: { category: "conflict", retryable: false },
  PUBLISHING_DELIVERY_STALE_REVISION: { category: "approval", retryable: false },
  PUBLISHING_DELIVERY_AUTHORIZATION_STALE: { category: "authorization", retryable: true },
  PUBLISHING_DELIVERY_CANCELLATION_NOT_AUTHORIZED: { category: "authorization", retryable: false },
  PUBLISHING_DELIVERY_RECOVERY_NOT_AUTHORIZED: { category: "authorization", retryable: false },
  PUBLISHING_DELIVERY_RETRY_NOT_SAFE: { category: "conflict", retryable: false },
  PUBLISHING_DELIVERY_RECONCILIATION_NOT_AVAILABLE: { category: "conflict", retryable: false },
  PUBLISHING_DELIVERY_VALIDATION_STALE: { category: "approval", retryable: true },
  PUBLISHING_DELIVERY_PERSISTENCE_UNAVAILABLE: { category: "internal", retryable: true },
};

export const PUBLISHING_DELIVERY_ERROR_CONTRACTS: CapabilityErrorContract[] = [
  ["PUBLISHING_DELIVERY_INVALID_INPUT", "validation", false, "The Publishing Delivery request is malformed."],
  ["PUBLISHING_DELIVERY_NOT_FOUND", "not_found", false, "The Publishing Delivery is unavailable."],
  ["PUBLISHING_DELIVERY_IDEMPOTENCY_CONFLICT", "conflict", false, "The idempotency key is bound to another Publishing Delivery mutation."],
  ["PUBLISHING_DELIVERY_APPROVAL_INVALID", "approval", false, "The exact approved request is not valid for release."],
  ["PUBLISHING_DELIVERY_APPROVAL_CONSUMED", "conflict", false, "The Approval decision was already released."],
  ["PUBLISHING_DELIVERY_STALE_REVISION", "approval", false, "The approved Plan Revision is no longer current."],
  ["PUBLISHING_DELIVERY_AUTHORIZATION_STALE", "authorization", true, "Exact release authorization is missing or stale."],
  ["PUBLISHING_DELIVERY_CANCELLATION_NOT_AUTHORIZED", "authorization", false, "Exact current cancellation authority is missing."],
  ["PUBLISHING_DELIVERY_RECOVERY_NOT_AUTHORIZED", "authorization", false, "Exact current retry or reconciliation authority is missing."],
  ["PUBLISHING_DELIVERY_RETRY_NOT_SAFE", "conflict", false, "Retained effect evidence does not prove that retry is safe."],
  ["PUBLISHING_DELIVERY_RECONCILIATION_NOT_AVAILABLE", "conflict", false, "The exact ambiguous effect is not available for reconciliation."],
  ["PUBLISHING_DELIVERY_VALIDATION_STALE", "approval", true, "Publish Validation is missing or stale."],
  ["PUBLISHING_DELIVERY_PERSISTENCE_UNAVAILABLE", "internal", true, "Durable release could not be committed."],
].map(([code, category, retryable, description]) => ({
  code: code as PublishingDeliveryServiceErrorCode,
  category: category as CapabilityErrorContract["category"],
  retryable: retryable as boolean,
  description: description as string,
}));
