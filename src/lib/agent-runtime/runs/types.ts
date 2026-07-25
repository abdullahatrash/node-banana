import type { ResolvedWorkflowDefinition } from "../workflows/types";

export type WorkflowRunState = "accepted" | "running" | "completed" | "failed";

export interface WorkflowRunStartSnapshot {
  schema: "workflow-run-start-snapshot/v1";
  workflowId: string;
  workflowRevisionId: string;
  workflowRevision: number;
  definitionDigest: string;
  operationRegistryDigest: string;
  definition: ResolvedWorkflowDefinition;
  inputs: Array<{
    name: string;
    kind: "text" | "image";
    value: unknown;
  }>;
  operationContracts: Array<{
    stepId: string;
    identity: string;
    contractDigest: string;
  }>;
  artifactReferences: Array<{
    inputName: string;
    artifactId: string;
  }>;
  credentialReferences: Array<{
    stepId: string;
    requirement: string;
    slotId: string;
  }>;
  authorization: {
    principalId: string;
    keyId: string;
    evidenceRef: string;
  };
}

export interface WorkflowRunRecord {
  id: string;
  workspaceId: string;
  workflowId: string;
  workflowRevisionId: string;
  state: WorkflowRunState;
  startSnapshotDigest: string;
  startSnapshot: WorkflowRunStartSnapshot;
  nextEventSequence: number;
  output: Record<string, unknown> | null;
  failureCode: string | null;
  acceptedAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  updatedAt: Date;
}

export interface WorkflowRunEventRecord {
  id: string;
  workspaceId: string;
  runId: string;
  sequence: number;
  type:
    | "run.accepted"
    | "step.completed"
    | "run.completed"
    | "run.failed";
  data: Record<string, unknown>;
  occurredAt: Date;
}

export interface WorkflowRunMutationReceiptRecord {
  workspaceId: string;
  principalId: string;
  capability: "workflow_runs.start@1";
  idempotencyKey: string;
  requestFingerprint: string;
  runId: string;
  initialEventCursor: string;
  createdAt: Date;
}

export interface WorkflowRunOutboxIntentRecord {
  id: string;
  workspaceId: string;
  runId: string;
  dedupeKey: string;
  state: "pending" | "delivering" | "delivered";
  deliveryToken: string | null;
  deliveryAttempts: number;
  availableAt: Date;
  claimedAt: Date | null;
  deliveredAt: Date | null;
  createdAt: Date;
}

export interface WorkflowRunExecutionLeaseRecord {
  workspaceId: string;
  runId: string;
  fence: bigint;
  workerId: string;
  token: string;
  acquiredAt: Date;
  expiresAt: Date;
  releasedAt: Date | null;
}

export interface WorkflowRunDto {
  id: string;
  workspaceId: string;
  workflowId: string;
  workflowRevisionId: string;
  state: WorkflowRunState;
  startSnapshotDigest: string;
  startSnapshot: WorkflowRunStartSnapshot;
  output: Record<string, unknown> | null;
  failureCode: string | null;
  acceptedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  updatedAt: string;
}

export interface WorkflowRunAcceptedDto {
  run: {
    id: string;
    workflowId: string;
    workflowRevisionId: string;
    state: "accepted";
    startSnapshotDigest: string;
    acceptedAt: string;
  };
  inspect: {
    capability: "workflow_runs.get@1";
    input: { workflowId: string; runId: string };
  };
  events: {
    capability: "workflow_run_events.list@1";
    input: { workflowId: string; runId: string; cursor: string };
  };
}

export interface WorkflowRunEventDto {
  id: string;
  runId: string;
  sequence: number;
  type: WorkflowRunEventRecord["type"];
  data: Record<string, unknown>;
  occurredAt: string;
}

export type StartWorkflowRunResult =
  | {
      kind: "created" | "replayed";
      run: WorkflowRunRecord;
      receipt: WorkflowRunMutationReceiptRecord;
    }
  | { kind: "conflict" }
  | { kind: "unavailable" };

export type ClaimWorkflowRunOutboxResult =
  | { kind: "claimed"; intent: WorkflowRunOutboxIntentRecord }
  | { kind: "empty" };

export type AcquireWorkflowRunLeaseResult =
  | {
      kind: "acquired";
      run: WorkflowRunRecord;
      lease: WorkflowRunExecutionLeaseRecord;
    }
  | { kind: "completed"; run: WorkflowRunRecord }
  | { kind: "busy" }
  | { kind: "unavailable" };

export type CompleteWorkflowRunStepResult =
  | { kind: "completed"; run: WorkflowRunRecord }
  | { kind: "stale_fence" }
  | { kind: "unavailable" };

export interface WorkflowRunRepository {
  start(input: {
    run: WorkflowRunRecord;
    firstEvent: WorkflowRunEventRecord;
    receipt: WorkflowRunMutationReceiptRecord;
    outboxIntent: WorkflowRunOutboxIntentRecord;
  }): Promise<StartWorkflowRunResult>;
  get(input: {
    workspaceId: string;
    workflowId: string;
    runId: string;
  }): Promise<WorkflowRunRecord | null>;
  listEvents(input: {
    workspaceId: string;
    workflowId: string;
    runId: string;
    afterSequence: number;
    limit: number;
  }): Promise<WorkflowRunEventRecord[] | null>;
  claimOutbox(input: {
    now: Date;
    claimExpiresBefore: Date;
    deliveryToken: string;
  }): Promise<ClaimWorkflowRunOutboxResult>;
  markOutboxDelivered(input: {
    intentId: string;
    deliveryToken: string;
    deliveredAt: Date;
  }): Promise<boolean>;
  releaseOutbox(input: {
    intentId: string;
    deliveryToken: string;
    availableAt: Date;
  }): Promise<void>;
  acquireLease(input: {
    workspaceId: string;
    runId: string;
    workerId: string;
    now: Date;
    expiresAt: Date;
  }): Promise<AcquireWorkflowRunLeaseResult>;
  completeStep(input: {
    workspaceId: string;
    runId: string;
    workerId: string;
    token: string;
    fence: bigint;
    output: Record<string, unknown>;
    completedAt: Date;
    stepEventId: string;
    runEventId: string;
  }): Promise<CompleteWorkflowRunStepResult>;
  failStep(input: {
    workspaceId: string;
    runId: string;
    workerId: string;
    token: string;
    fence: bigint;
    failureCode: string;
    failedAt: Date;
    runEventId: string;
  }): Promise<CompleteWorkflowRunStepResult>;
}

export interface WorkflowRunRevisionReader {
  getRevision(input: {
    workspaceId: string;
    workflowId: string;
    revisionId: string;
  }): Promise<{
    id: string;
    workflowId: string;
    revision: number;
    definitionDigest: string;
    definition: ResolvedWorkflowDefinition;
    operationRegistryDigest: string;
  } | null>;
}

export interface WorkflowRunQueue {
  schedule(input: {
    workspaceId: string;
    runId: string;
    dedupeKey: string;
  }): Promise<void>;
}

export interface WorkflowRunEventCursorCodec {
  seal(input: {
    workspaceId: string;
    principalId: string;
    workflowId: string;
    runId: string;
    afterSequence: number;
  }): string;
  open(input: {
    cursor: string;
    workspaceId: string;
    principalId: string;
    workflowId: string;
    runId: string;
  }): number;
}

export interface WorkflowStepExecutor {
  execute(input: {
    runId: string;
    snapshot: WorkflowRunStartSnapshot;
    step: ResolvedWorkflowDefinition["steps"][number];
  }): Promise<Record<string, unknown>>;
}

export interface WorkflowStepExecutorRegistry {
  get(
    identity: string,
    contractDigest: string,
  ): WorkflowStepExecutor | undefined;
}

export interface WorkflowRunClock {
  now(): Date;
}
