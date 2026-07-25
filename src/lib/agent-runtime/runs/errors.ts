import type { CapabilityErrorContract } from "@/types/capabilities";

export const WORKFLOW_RUN_ERROR_CATALOG = {
  WORKFLOW_RUN_INVALID_INPUT: {
    category: "validation",
    retryable: false,
    description: "Workflow Run input violates the published contract.",
  },
  WORKFLOW_RUN_IDEMPOTENCY_CONFLICT: {
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
} as const satisfies Record<string, Omit<CapabilityErrorContract, "code">>;

export type WorkflowRunErrorCode = keyof typeof WORKFLOW_RUN_ERROR_CATALOG;

export class WorkflowRunError extends Error {
  readonly retryable: boolean;

  constructor(
    readonly code: WorkflowRunErrorCode,
    message: string,
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
  "WORKFLOW_RUN_IDEMPOTENCY_CONFLICT",
  "WORKFLOW_RUN_UNAVAILABLE",
  "WORKFLOW_RUN_UNSUPPORTED_WORKFLOW",
  "WORKFLOW_RUN_PERSISTENCE_UNAVAILABLE",
];

export const WORKFLOW_RUN_PUBLIC_ERROR_CONTRACTS: CapabilityErrorContract[] =
  PUBLIC_ERROR_CODES.map((code) => ({
    code,
    ...WORKFLOW_RUN_ERROR_CATALOG[code],
  }));
