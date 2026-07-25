import type { ResolvedWorkflowDefinition } from "../workflows/types";
import type {
  ArtifactKind,
  ArtifactMetadata,
} from "../artifacts/types";

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
    digest: string;
    kind: ArtifactKind;
    mediaType: string;
    sizeBytes: number;
    width: number | null;
    height: number | null;
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

export interface WorkflowRunArtifactReference {
  artifactId: string;
  digest: string;
  kind: ArtifactKind;
  mediaType: string;
  sizeBytes: number;
}

export interface WorkflowRunFinalSnapshot {
  schema: "workflow-run-final-snapshot/v1";
  runId: string;
  startSnapshotDigest: string;
  stepAttempts: Array<{
    stepAttemptId: string;
    stepId: string;
    attempt: number;
    state: "completed";
    effectKey: string;
    outputs: Record<string, WorkflowRunArtifactReference>;
  }>;
  outputs: Record<string, WorkflowRunArtifactReference>;
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
  finalSnapshot: WorkflowRunFinalSnapshot | null;
  finalSnapshotDigest: string | null;
  failureCode: string | null;
  acceptedAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  updatedAt: Date;
}

export type WorkflowStepAttemptState = "running" | "completed" | "failed";

export interface WorkflowStepAttemptInput {
  port: string;
  kind: ArtifactKind;
  source:
    | { kind: "workflow_input"; inputName: string }
    | {
        kind: "step_output";
        stepAttemptId: string;
        outputName: string;
      };
  contentDigest: string;
  artifactId: string | null;
}

export interface WorkflowStepAttemptRecord {
  id: string;
  workspaceId: string;
  runId: string;
  stepId: string;
  attempt: number;
  state: WorkflowStepAttemptState;
  operationIdentity: string;
  operationContractDigest: string;
  provider: string;
  providerOperation: string;
  model: string;
  intentDigest: string;
  effectKey: string;
  inputs: WorkflowStepAttemptInput[];
  outputs: Record<string, WorkflowRunArtifactReference> | null;
  failureCode: string | null;
  startedAt: Date;
  completedAt: Date | null;
}

export interface WorkflowStepAttemptDto
  extends Omit<
    WorkflowStepAttemptRecord,
    "startedAt" | "completedAt" | "inputs" | "outputs"
  > {
  inputs: WorkflowStepAttemptInput[];
  outputs: Record<string, WorkflowRunArtifactReference> | null;
  startedAt: string;
  completedAt: string | null;
}

export interface WorkflowRunEventRecord {
  id: string;
  workspaceId: string;
  runId: string;
  sequence: number;
  type:
    | "run.accepted"
    | "step.attempt.started"
    | "artifact.generated"
    | "step.attempt.completed"
    | "step.attempt.failed"
    | "step.completed"
    | "run.completed"
    | "run.failed";
  data: Record<string, unknown>;
  occurredAt: Date;
}

export interface WorkflowRunMutationReceiptRecord {
  workspaceId: string;
  principalId: string;
  capability: "workflow_runs.start@1" | "workflow_runs.start@2";
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
  finalSnapshot: WorkflowRunFinalSnapshot | null;
  finalSnapshotDigest: string | null;
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

export type PrepareWorkflowStepAttemptResult =
  | {
      kind: "created" | "replayed";
      run: WorkflowRunRecord;
      attempt: WorkflowStepAttemptRecord;
    }
  | { kind: "conflict" }
  | { kind: "stale_fence" }
  | { kind: "unavailable" };

export type SettleWorkflowStepAttemptResult =
  | {
      kind: "settled";
      run: WorkflowRunRecord;
      attempt: WorkflowStepAttemptRecord;
    }
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
  listStepAttempts(input: {
    workspaceId: string;
    runId: string;
  }): Promise<WorkflowStepAttemptRecord[] | null>;
  prepareStepAttempt(input: {
    attempt: WorkflowStepAttemptRecord;
    workerId: string;
    token: string;
    fence: bigint;
    eventId: string;
  }): Promise<PrepareWorkflowStepAttemptResult>;
  settleStepAttempt(input: {
    workspaceId: string;
    runId: string;
    stepAttemptId: string;
    workerId: string;
    token: string;
    fence: bigint;
    outputs: Record<string, WorkflowRunArtifactReference>;
    finalSnapshot: WorkflowRunFinalSnapshot | null;
    finalSnapshotDigest: string | null;
    completedAt: Date;
    eventIds: {
      generated: string[];
      attemptCompleted: string;
      runCompleted: string | null;
    };
  }): Promise<SettleWorkflowStepAttemptResult>;
  failStepAttempt(input: {
    workspaceId: string;
    runId: string;
    stepAttemptId: string;
    workerId: string;
    token: string;
    fence: bigint;
    failureCode: string;
    failedAt: Date;
    eventIds: {
      attemptFailed: string;
      runFailed: string;
    };
  }): Promise<SettleWorkflowStepAttemptResult>;
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
  readonly provider: string;
  readonly providerOperation: string;
  readonly model: string;
  execute(input: {
    runId: string;
    stepAttemptId: string;
    effectKey: string;
    intentDigest: string;
    snapshot: WorkflowRunStartSnapshot;
    step: ResolvedWorkflowDefinition["steps"][number];
    inputs: Record<string, ResolvedWorkflowStepInput>;
  }): Promise<
    | {
        kind: "legacy";
        output: Record<string, unknown>;
      }
    | {
        kind: "generated";
        providerOperationRef: string;
        outputs: Record<
          string,
          | {
              kind: "text";
              mediaType: string;
              bytes: Uint8Array;
            }
          | {
              kind: "image";
              mediaType: string;
              bytes: Uint8Array;
              width: number;
              height: number;
            }
        >;
      }
  >;
}

export interface ResolvedWorkflowStepInput {
  kind: ArtifactKind;
  contentDigest: string;
  artifactId: string | null;
  textContent: string | null;
  mediaType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
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

export interface WorkflowRunArtifactPort {
  getArtifact(input: {
    workspaceId: string;
    artifactId: string;
  }): Promise<{
    artifact: ArtifactMetadata;
    textContent: string | null;
  }>;
  commitGenerated(input: {
    workspaceId: string;
    creatorPrincipalId: string;
    effectKey: string;
    outputName: string;
    content:
      | {
          kind: "text";
          text: string;
          mediaType: string;
          digest: string;
          sizeBytes: number;
        }
      | {
          kind: "image";
          bytes: Uint8Array;
          mediaType: string;
          digest: string;
          sizeBytes: number;
          width: number;
          height: number;
        };
    origin: Omit<
      import("../artifacts/types").ArtifactGeneratedOriginRecord,
      | "artifactId"
      | "workspaceId"
      | "effectKey"
      | "outputName"
      | "generatedAt"
    >;
    lineageInputs: Array<
      Omit<
        import("../artifacts/types").ArtifactLineageInputRecord,
        "workspaceId" | "artifactId" | "position"
      >
    >;
  }): Promise<ArtifactMetadata>;
}
