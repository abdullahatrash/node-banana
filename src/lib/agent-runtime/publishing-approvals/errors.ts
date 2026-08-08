import type { CapabilityErrorContract } from "@/types/capabilities";

export type PublishingApprovalServiceErrorCode =
  | "PUBLISHING_APPROVAL_INVALID_INPUT"
  | "PUBLISHING_APPROVAL_NOT_FOUND"
  | "PUBLISHING_APPROVAL_IDEMPOTENCY_CONFLICT"
  | "PUBLISHING_APPROVAL_STALE_VIEW"
  | "PUBLISHING_APPROVAL_STALE_REVISION"
  | "PUBLISHING_APPROVAL_STALE_VALIDATION"
  | "PUBLISHING_APPROVAL_EXPIRED"
  | "PUBLISHING_APPROVAL_FINAL"
  | "PUBLISHING_APPROVAL_AUTHORITY_REQUIRED"
  | "PUBLISHING_APPROVAL_PERSISTENCE_UNAVAILABLE";

export class PublishingApprovalServiceError extends Error {
  constructor(
    readonly code: PublishingApprovalServiceErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "PublishingApprovalServiceError";
  }
}

export const PUBLISHING_APPROVAL_ERROR_CATALOG: Record<
  PublishingApprovalServiceErrorCode,
  { category: CapabilityErrorContract["category"]; retryable: boolean }
> = {
  PUBLISHING_APPROVAL_INVALID_INPUT: { category: "validation", retryable: false },
  PUBLISHING_APPROVAL_NOT_FOUND: { category: "not_found", retryable: false },
  PUBLISHING_APPROVAL_IDEMPOTENCY_CONFLICT: { category: "conflict", retryable: false },
  PUBLISHING_APPROVAL_STALE_VIEW: { category: "conflict", retryable: true },
  PUBLISHING_APPROVAL_STALE_REVISION: { category: "approval", retryable: false },
  PUBLISHING_APPROVAL_STALE_VALIDATION: { category: "approval", retryable: true },
  PUBLISHING_APPROVAL_EXPIRED: { category: "approval", retryable: false },
  PUBLISHING_APPROVAL_FINAL: { category: "conflict", retryable: false },
  PUBLISHING_APPROVAL_AUTHORITY_REQUIRED: { category: "authorization", retryable: false },
  PUBLISHING_APPROVAL_PERSISTENCE_UNAVAILABLE: { category: "internal", retryable: true },
};

export const PUBLISHING_APPROVAL_ERROR_CONTRACTS: CapabilityErrorContract[] = [
  ["PUBLISHING_APPROVAL_INVALID_INPUT", "validation", false, "The Approval request is malformed."],
  ["PUBLISHING_APPROVAL_NOT_FOUND", "not_found", false, "The Approval request is unavailable."],
  ["PUBLISHING_APPROVAL_IDEMPOTENCY_CONFLICT", "conflict", false, "The idempotency key is bound to another Approval mutation."],
  ["PUBLISHING_APPROVAL_STALE_VIEW", "conflict", true, "The Cockpit decision was based on a stale request view."],
  ["PUBLISHING_APPROVAL_STALE_REVISION", "approval", false, "The bound Plan Revision is no longer the current head."],
  ["PUBLISHING_APPROVAL_STALE_VALIDATION", "approval", true, "The bound Publish Validation evidence is no longer current."],
  ["PUBLISHING_APPROVAL_EXPIRED", "approval", false, "The Approval decision window expired."],
  ["PUBLISHING_APPROVAL_FINAL", "conflict", false, "The Approval request already has a final decision."],
  ["PUBLISHING_APPROVAL_AUTHORITY_REQUIRED", "authorization", false, "Explicit current Approval Authority is required for every affected Channel and action."],
  ["PUBLISHING_APPROVAL_PERSISTENCE_UNAVAILABLE", "internal", true, "The durable Approval mutation could not be committed."],
].map(([code, category, retryable, description]) => ({
  code: code as PublishingApprovalServiceErrorCode,
  category: category as CapabilityErrorContract["category"],
  retryable: retryable as boolean,
  description: description as string,
}));
