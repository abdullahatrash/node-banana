import type { CapabilityErrorContract } from "@/types/capabilities";

export type PublishingPlanServiceErrorCode =
  | "PUBLISHING_PLAN_INVALID_INPUT"
  | "PUBLISHING_PLAN_VALIDATION_FAILED"
  | "PUBLISHING_PLAN_NOT_FOUND"
  | "PUBLISHING_PLAN_IDEMPOTENCY_CONFLICT"
  | "PUBLISHING_PLAN_EDIT_CONFLICT"
  | "PUBLISHING_PLAN_REVISION_CONFLICT"
  | "PUBLISHING_PLAN_VALIDATION_EXPIRED"
  | "PUBLISHING_PLAN_PERSISTENCE_UNAVAILABLE"
  | "PUBLISHING_PLAN_CURSOR_INVALID";

export class PublishingPlanServiceError extends Error {
  constructor(
    readonly code: PublishingPlanServiceErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "PublishingPlanServiceError";
  }
}

export const PUBLISHING_PLAN_ERROR_CATALOG: Record<
  PublishingPlanServiceErrorCode,
  { category: CapabilityErrorContract["category"]; retryable: boolean }
> = {
  PUBLISHING_PLAN_INVALID_INPUT: { category: "validation", retryable: false },
  PUBLISHING_PLAN_VALIDATION_FAILED: {
    category: "validation",
    retryable: false,
  },
  PUBLISHING_PLAN_NOT_FOUND: { category: "not_found", retryable: false },
  PUBLISHING_PLAN_IDEMPOTENCY_CONFLICT: {
    category: "conflict",
    retryable: false,
  },
  PUBLISHING_PLAN_EDIT_CONFLICT: { category: "conflict", retryable: false },
  PUBLISHING_PLAN_REVISION_CONFLICT: {
    category: "conflict",
    retryable: false,
  },
  PUBLISHING_PLAN_VALIDATION_EXPIRED: {
    category: "conflict",
    retryable: true,
  },
  PUBLISHING_PLAN_PERSISTENCE_UNAVAILABLE: {
    category: "internal",
    retryable: true,
  },
  PUBLISHING_PLAN_CURSOR_INVALID: {
    category: "validation",
    retryable: false,
  },
};

export const PUBLISHING_PLAN_ERROR_CONTRACTS: CapabilityErrorContract[] = [
  {
    code: "PUBLISHING_PLAN_INVALID_INPUT",
    category: "validation",
    retryable: false,
    description: "The Publishing Plan request is malformed.",
  },
  {
    code: "PUBLISHING_PLAN_VALIDATION_FAILED",
    category: "validation",
    retryable: false,
    description: "Current target validation blocked revision creation.",
  },
  {
    code: "PUBLISHING_PLAN_NOT_FOUND",
    category: "not_found",
    retryable: false,
    description: "The immutable Publishing Plan Revision is unavailable.",
  },
  {
    code: "PUBLISHING_PLAN_IDEMPOTENCY_CONFLICT",
    category: "conflict",
    retryable: false,
    description: "The idempotency key is bound to another request.",
  },
  {
    code: "PUBLISHING_PLAN_PERSISTENCE_UNAVAILABLE",
    category: "internal",
    retryable: true,
    description: "The Publishing Plan Revision could not be committed.",
  },
  {
    code: "PUBLISHING_PLAN_EDIT_CONFLICT",
    category: "conflict",
    retryable: false,
    description: "The Publishing Plan cannot be created or edited by this request.",
  },
  {
    code: "PUBLISHING_PLAN_REVISION_CONFLICT",
    category: "conflict",
    retryable: false,
    description: "The expected Publishing Plan Revision is stale.",
  },
  {
    code: "PUBLISHING_PLAN_VALIDATION_EXPIRED",
    category: "conflict",
    retryable: true,
    description: "Current validation changed before the revision committed.",
  },
  {
    code: "PUBLISHING_PLAN_CURSOR_INVALID",
    category: "validation",
    retryable: false,
    description: "The Publishing Plan cursor is invalid or unavailable.",
  },
];
