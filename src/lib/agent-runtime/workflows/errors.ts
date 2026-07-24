import type { CapabilityErrorContract } from "@/types/capabilities";
import type { WorkflowValidationIssue } from "./types";

export const WORKFLOW_ERROR_CATALOG = {
  WORKFLOW_INVALID_INPUT: {
    category: "validation",
    retryable: false,
    description: "Workflow input violates the published contract.",
  },
  WORKFLOW_VALIDATION_FAILED: {
    category: "validation",
    retryable: false,
    description: "The Workflow draft did not pass semantic validation.",
  },
  WORKFLOW_IDEMPOTENCY_CONFLICT: {
    category: "conflict",
    retryable: false,
    description: "The idempotency key is bound to another request.",
  },
  WORKFLOW_REVISION_CONFLICT: {
    category: "conflict",
    retryable: false,
    description: "The Workflow revision could not be appended.",
  },
  WORKFLOW_UNAVAILABLE: {
    category: "not_found",
    retryable: false,
    description: "The Workflow or immutable revision is unavailable.",
  },
  WORKFLOW_PERSISTENCE_UNAVAILABLE: {
    category: "internal",
    retryable: true,
    description: "Workflow persistence is temporarily unavailable.",
  },
} as const satisfies Record<string, Omit<CapabilityErrorContract, "code">>;

export type WorkflowServiceErrorCode = keyof typeof WORKFLOW_ERROR_CATALOG;

export class WorkflowServiceError extends Error {
  readonly retryable: boolean;

  constructor(
    readonly code: WorkflowServiceErrorCode,
    message: string,
    readonly issues?: WorkflowValidationIssue[],
  ) {
    super(message);
    this.name = "WorkflowServiceError";
    this.retryable = WORKFLOW_ERROR_CATALOG[code].retryable;
  }
}

export const WORKFLOW_ERROR_CONTRACTS: CapabilityErrorContract[] =
  Object.entries(WORKFLOW_ERROR_CATALOG).map(([code, contract]) => ({
    code,
    ...contract,
  }));
