import type { CapabilityErrorContract } from "@/types/capabilities";

export type AutomationServiceErrorCode =
  | "AUTOMATION_INVALID_INPUT"
  | "AUTOMATION_NOT_FOUND"
  | "AUTOMATION_REVISION_NOT_FOUND"
  | "AUTOMATION_OCCURRENCE_NOT_FOUND"
  | "AUTOMATION_NOT_ACTIVE"
  | "NO_ACTIVE_AUTOMATION_REVISION"
  | "AUTOMATION_REVISION_INVALID"
  | "AUTOMATION_TRIGGER_NOT_SUPPORTED"
  | "AUTOMATION_REFERENCE_STALE"
  | "IDEMPOTENCY_CONFLICT"
  | "AUTOMATION_STALE_CONTROL_VERSION"
  | "AUTOMATION_AUTHORIZATION_STALE"
  | "AUTOMATION_OCCURRENCE_NOT_RETRYABLE"
  | "AUTOMATION_PERSISTENCE_UNAVAILABLE";

export class AutomationServiceError extends Error {
  constructor(
    readonly code: AutomationServiceErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "AutomationServiceError";
  }
}

export const AUTOMATION_ERROR_CATALOG: Record<
  AutomationServiceErrorCode,
  { category: CapabilityErrorContract["category"]; retryable: boolean }
> = {
  AUTOMATION_INVALID_INPUT: { category: "validation", retryable: false },
  AUTOMATION_NOT_FOUND: { category: "not_found", retryable: false },
  AUTOMATION_REVISION_NOT_FOUND: { category: "not_found", retryable: false },
  AUTOMATION_OCCURRENCE_NOT_FOUND: { category: "not_found", retryable: false },
  AUTOMATION_NOT_ACTIVE: { category: "conflict", retryable: false },
  NO_ACTIVE_AUTOMATION_REVISION: { category: "conflict", retryable: false },
  AUTOMATION_REVISION_INVALID: { category: "validation", retryable: false },
  AUTOMATION_TRIGGER_NOT_SUPPORTED: { category: "validation", retryable: false },
  AUTOMATION_REFERENCE_STALE: { category: "conflict", retryable: false },
  IDEMPOTENCY_CONFLICT: { category: "conflict", retryable: false },
  AUTOMATION_STALE_CONTROL_VERSION: { category: "conflict", retryable: true },
  AUTOMATION_AUTHORIZATION_STALE: { category: "authorization", retryable: true },
  AUTOMATION_OCCURRENCE_NOT_RETRYABLE: { category: "conflict", retryable: false },
  AUTOMATION_PERSISTENCE_UNAVAILABLE: { category: "internal", retryable: true },
};

export const AUTOMATION_ERROR_CONTRACTS: CapabilityErrorContract[] =
  Object.entries(AUTOMATION_ERROR_CATALOG).map(
    ([code, value]) => ({
      code,
      category: value.category,
      retryable: value.retryable,
      description: "The Automation request could not be completed.",
    }),
  );

export class AutomationMaterializationError extends Error {
  constructor(
    readonly failureCode: string,
    readonly retryable: boolean,
  ) {
    super("Automation Workflow materialization failed.");
    this.name = "AutomationMaterializationError";
  }
}
