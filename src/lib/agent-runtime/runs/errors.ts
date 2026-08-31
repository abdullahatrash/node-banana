import type { CapabilityErrorContract } from "@/types/capabilities";

export const WORKFLOW_RUN_ERROR_CATALOG = {
  WORKFLOW_RUN_INVALID_INPUT: {
    category: "validation",
    retryable: false,
    description: "Workflow Run input violates the published contract.",
  },
  IDEMPOTENCY_CONFLICT: {
    category: "conflict",
    retryable: false,
    description: "The idempotency key is bound to another Workflow Run.",
  },
  WORKFLOW_RUN_UNAVAILABLE: {
    category: "not_found",
    retryable: false,
    description: "The Workflow Run or immutable Workflow Revision is unavailable.",
  },
  WORKFLOW_RUN_UNSUPPORTED_WORKFLOW: {
    category: "validation",
    retryable: false,
    description: "This runtime slice accepts exactly one deterministic step.",
  },
  WORKFLOW_RUN_PERSISTENCE_UNAVAILABLE: {
    category: "internal",
    retryable: true,
    description: "Workflow Run persistence is temporarily unavailable.",
  },
  WORKFLOW_RUN_DELIVERY_UNAVAILABLE: {
    category: "internal",
    retryable: true,
    description: "Workflow Run delivery is temporarily unavailable.",
  },
  WORKFLOW_RUN_LEASE_BUSY: {
    category: "conflict",
    retryable: true,
    description: "Another fenced worker currently owns the Workflow Run.",
  },
  WORKFLOW_RUN_STALE_FENCE: {
    category: "conflict",
    retryable: false,
    description: "A stale worker cannot mutate the Workflow Run.",
  },
  WORKFLOW_RUN_NOT_RESUMABLE: {
    category: "conflict",
    retryable: false,
    description: "The Workflow Run is not in a known-safe resumable state.",
  },
  WORKFLOW_RUN_RECONCILIATION_REQUIRED: {
    category: "conflict",
    retryable: false,
    description: "The Workflow Run has an unknown provider outcome that must be reconciled.",
  },
  WORKFLOW_RUN_RECONCILIATION_PENDING: {
    category: "conflict",
    retryable: true,
    description: "The provider outcome is still unknown.",
  },
  BUDGET_LIMIT_EXCEEDED: {
    category: "authorization",
    retryable: false,
    description: "The proposed Run exceeds an applicable Budget Policy.",
  },
  RUN_COST_UNKNOWN: {
    category: "authorization",
    retryable: false,
    description: "The proposed Run has no policy-authorized conservative cost ceiling.",
  },
  CREDENTIAL_SPEND_NOT_AUTHORIZED: {
    category: "authorization",
    retryable: false,
    description: "A required Credential Spend Grant is unavailable.",
  },
  SPEND_SUSPENDED: {
    category: "authorization",
    retryable: false,
    description: "Emergency provider spend suspension is active.",
  },
  QUOTA_EXCEEDED: {
    category: "authorization",
    retryable: false,
    description: "The proposed Run exceeds an applicable non-monetary Quota Policy.",
  },
  ARTIFACT_QUOTA_EXCEEDED: {
    category: "authorization",
    retryable: false,
    description:
      "A generated Artifact exceeds an applicable non-monetary storage Quota Policy.",
  },
} as const satisfies Record<string, Omit<CapabilityErrorContract, "code">>;

export type WorkflowRunErrorCode = keyof typeof WORKFLOW_RUN_ERROR_CATALOG;

export class WorkflowRunError extends Error {
  readonly retryable: boolean;

  constructor(
    readonly code: WorkflowRunErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "WorkflowRunError";
    this.retryable = WORKFLOW_RUN_ERROR_CATALOG[code].retryable;
  }
}

export const WORKFLOW_RUN_ERROR_CONTRACTS: CapabilityErrorContract[] =
  Object.entries(WORKFLOW_RUN_ERROR_CATALOG).map(([code, contract]) => ({
    code,
    ...contract,
  }));

const PUBLIC_ERROR_CODES: WorkflowRunErrorCode[] = [
  "WORKFLOW_RUN_INVALID_INPUT",
  "IDEMPOTENCY_CONFLICT",
  "WORKFLOW_RUN_UNAVAILABLE",
  "WORKFLOW_RUN_UNSUPPORTED_WORKFLOW",
  "WORKFLOW_RUN_PERSISTENCE_UNAVAILABLE",
  "WORKFLOW_RUN_NOT_RESUMABLE",
  "WORKFLOW_RUN_RECONCILIATION_REQUIRED",
  "WORKFLOW_RUN_RECONCILIATION_PENDING",
  "BUDGET_LIMIT_EXCEEDED",
  "RUN_COST_UNKNOWN",
  "CREDENTIAL_SPEND_NOT_AUTHORIZED",
  "SPEND_SUSPENDED",
  "QUOTA_EXCEEDED",
  "ARTIFACT_QUOTA_EXCEEDED",
];

export const WORKFLOW_RUN_PUBLIC_ERROR_CONTRACTS: CapabilityErrorContract[] =
  PUBLIC_ERROR_CODES.map((code) => ({
    code,
    ...WORKFLOW_RUN_ERROR_CATALOG[code],
  }));
