import type { ResolvedWorkflowDefinition } from "../workflows/types";
import type {
  ArtifactKind,
  ArtifactMetadata,
  ArtifactProviderMetadata,
} from "../artifacts/types";

export type WorkflowRunState =
  | "accepted"
  | "running"
  | "waiting"
  | "outcome_unknown"
  | "completed"
  | "failed";

interface WorkflowRunStartSnapshotBase {
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

export type WorkflowRunStartSnapshot =
  | (WorkflowRunStartSnapshotBase & {
      schema: "workflow-run-start-snapshot/v1";
      providerResolutions?: never;
    })
  | (WorkflowRunStartSnapshotBase & {
      schema: "workflow-run-start-snapshot/v2";
      providerResolutions: WorkflowRunProviderResolution[];
    });

export interface WorkflowProviderLaunchSafety {
  mode: "native_effect_key" | "durable_at_most_once";
  guard: "workflow-step-attempt/v1";
  replay: "provider_deduplicated" | "never_launch";
}

export interface WorkflowRunProviderResolution {
  stepId: string;
  adapterModule: string;
  adapterContractDigest: string;
  provider: string;
  providerOperation: string;
  model: string;
  effectKeySupport: "native" | "unsupported";
  observation: "none" | "provider_operation_ref";
  launchSafety: WorkflowProviderLaunchSafety;
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
    providerOperationRef: string;
  }>;
  outputs: Record<string, WorkflowRunArtifactReference>;
}

export interface WorkflowRunDerivation {
  kind: "manual_retry";
  sourceRunId: string;
  rootRunId: string;
  sourceStartSnapshotDigest: string;
  retryFromStepId: string;
  reusedOutputs: Array<{
    stepId: string;
    sourceRunId: string;
    sourceStepAttemptId: string;
    sourceAttempt: number;
    sourceEffectKey: string;
    sourceProviderOperationRef: string;
    outputs: Record<string, WorkflowRunArtifactReference>;
  }>;
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
  derivation: WorkflowRunDerivation | null;
  resumeAt: Date | null;
  failureCode: string | null;
  acceptedAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  updatedAt: Date;
}

export type WorkflowStepAttemptState =
  | "running"
  | "outcome_unknown"
  | "completed"
  | "failed";

export interface WorkflowStepAttemptInput {
  port: string;
  kind: ArtifactKind;
  source:
    | { kind: "workflow_input"; inputName: string }
    | {
        kind: "step_output";
        runId: string;
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
  providerAdapterModule?: string;
  providerAdapterContractDigest?: string;
  launchSafety?: WorkflowProviderLaunchSafety;
  intentDigest: string;
  effectKey: string;
  inputs: WorkflowStepAttemptInput[];
  outputs: Record<string, WorkflowRunArtifactReference> | null;
  providerOperationRef: string | null;
  outcome:
    | null
    | {
        kind: "succeeded";
        providerOperationRef: string;
      }
    | {
        kind: "failed_known";
        failureCode: string;
        retryable: boolean;
      }
    | {
        kind: "outcome_unknown";
        failureCode: string;
        priorSucceededProviderOperationRef: string | null;
      };
  providerMetadata?: WorkflowStepProviderMetadata | null;
  reconciliation: {
    reference: string;
    resolution: "succeeded" | "failed_known";
    reconciledAt: string;
  } | null;
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
  reconciliation: WorkflowStepAttemptRecord["reconciliation"];
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
    | "run.derived"
    | "step.attempt.started"
    | "artifact.generated"
    | "step.attempt.completed"
    | "step.attempt.failed"
    | "step.retry.scheduled"
    | "step.attempt.outcome_unknown"
    | "step.attempt.reconciled"
    | "run.waiting"
    | "run.resumed"
    | "run.outcome_unknown"
    | "step.completed"
    | "run.completed"
    | "run.failed";
  data: Record<string, unknown>;
  occurredAt: Date;
}

export interface WorkflowRunMutationReceiptRecord {
  workspaceId: string;
  principalId: string;
  keyId: string;
  authorizationEvidenceRef: string;
  capability:
    | "workflow_runs.start@1"
    | "workflow_runs.start@2"
    | "workflow_runs.retry@1"
    | "workflow_runs.reconcile@1"
    | "workflow_runs.resume@1";
  idempotencyKey: string;
  requestFingerprint: string;
  runId: string;
  initialEventCursor: string;
  result: Record<string, unknown> | null;
  createdAt: Date;
}

export interface WorkflowRunOutboxIntentRecord {
  id: string;
  workspaceId: string;
  runId: string;
  generation: number;
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
  derivation: WorkflowRunDerivation | null;
  resumeAt: string | null;
  failureCode: string | null;
  acceptedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  updatedAt: string;
}

export interface WorkflowRunRecoveryDto {
  run: WorkflowRunDto;
  inspect: {
    capability: "workflow_runs.get@1";
    input: { workflowId: string; runId: string };
  };
  events: {
    capability: "workflow_run_events.list@1";
    input: { workflowId: string; runId: string; cursor: string };
  };
}

export function workflowRunDto(run: WorkflowRunRecord): WorkflowRunDto {
  return {
    id: run.id,
    workspaceId: run.workspaceId,
    workflowId: run.workflowId,
    workflowRevisionId: run.workflowRevisionId,
    state: run.state,
    startSnapshotDigest: run.startSnapshotDigest,
    startSnapshot: structuredClone(run.startSnapshot),
    output: structuredClone(run.output),
    finalSnapshot: structuredClone(run.finalSnapshot),
    finalSnapshotDigest: run.finalSnapshotDigest,
    derivation: structuredClone(run.derivation),
    resumeAt: run.resumeAt?.toISOString() ?? null,
    failureCode: run.failureCode,
    acceptedAt: run.acceptedAt.toISOString(),
    startedAt: run.startedAt?.toISOString() ?? null,
    completedAt: run.completedAt?.toISOString() ?? null,
    updatedAt: run.updatedAt.toISOString(),
  };
}

export function workflowRunRecoveryDto(
  run: WorkflowRunRecord,
  initialEventCursor: string,
): WorkflowRunRecoveryDto {
  return {
    run: workflowRunDto(run),
    inspect: {
      capability: "workflow_runs.get@1",
      input: { workflowId: run.workflowId, runId: run.id },
    },
    events: {
      capability: "workflow_run_events.list@1",
      input: {
        workflowId: run.workflowId,
        runId: run.id,
        cursor: initialEventCursor,
      },
    },
  };
}

export function workflowRunReceiptResult(
  run: WorkflowRunRecord,
  initialEventCursor: string,
): Record<string, unknown> {
  return workflowRunRecoveryDto(
    run,
    initialEventCursor,
  ) as unknown as Record<string, unknown>;
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

export type MutateWorkflowRunResult =
  | {
      kind: "created" | "replayed";
      run: WorkflowRunRecord;
      receipt: WorkflowRunMutationReceiptRecord;
    }
  | { kind: "conflict" }
  | { kind: "stale_fence" }
  | { kind: "unavailable" };

export interface WorkflowRunRepository {
  getMutationReceipt(input: {
    workspaceId: string;
    principalId: string;
    capability: WorkflowRunMutationReceiptRecord["capability"];
    idempotencyKey: string;
  }): Promise<{
    receipt: WorkflowRunMutationReceiptRecord;
    run: WorkflowRunRecord;
  } | null>;
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
  renewLease(input: {
    workspaceId: string;
    runId: string;
    workerId: string;
    token: string;
    fence: bigint;
    now: Date;
    expiresAt: Date;
  }): Promise<
    | { kind: "renewed"; lease: WorkflowRunExecutionLeaseRecord }
    | { kind: "stale_fence" | "unavailable" }
  >;
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
  recordStepAttemptProviderSuccess(input: {
    workspaceId: string;
    runId: string;
    stepAttemptId: string;
    workerId: string;
    token: string;
    fence: bigint;
    providerOperationRef: string;
    providerMetadata?: WorkflowStepProviderMetadata | null;
    recordedAt: Date;
  }): Promise<SettleWorkflowStepAttemptResult>;
  settleStepAttempt(input: {
    workspaceId: string;
    runId: string;
    stepAttemptId: string;
    workerId: string;
    token: string;
    fence: bigint;
    outputs: Record<string, WorkflowRunArtifactReference>;
    providerOperationRef: string;
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
    providerOperationRef: string | null;
    retryable: boolean;
    providerMetadata?: WorkflowStepProviderMetadata | null;
    retryAt: Date | null;
    retryOutboxIntent: WorkflowRunOutboxIntentRecord | null;
    failedAt: Date;
    eventIds: {
      attemptFailed: string;
      retryScheduled: string | null;
      runWaiting: string | null;
      runFailed: string | null;
    };
  }): Promise<SettleWorkflowStepAttemptResult>;
  markStepAttemptOutcomeUnknown(input: {
    workspaceId: string;
    runId: string;
    stepAttemptId: string;
    workerId: string;
    token: string;
    fence: bigint;
    failureCode: string;
    providerOperationRef: string | null;
    providerMetadata?: WorkflowStepProviderMetadata | null;
    occurredAt: Date;
    eventIds: {
      attemptOutcomeUnknown: string;
      runOutcomeUnknown: string;
    };
  }): Promise<SettleWorkflowStepAttemptResult>;
  deriveRun(input: {
    run: WorkflowRunRecord;
    events: WorkflowRunEventRecord[];
    receipt: WorkflowRunMutationReceiptRecord;
    outboxIntent: WorkflowRunOutboxIntentRecord;
  }): Promise<MutateWorkflowRunResult>;
  resumeRun(input: {
    workspaceId: string;
    workflowId: string;
    runId: string;
    principalId: string;
    keyId: string;
    authorizationEvidenceRef: string;
    waitEventSequence: number;
    idempotencyKey: string;
    requestFingerprint: string;
    receipt: WorkflowRunMutationReceiptRecord;
    outboxIntent: WorkflowRunOutboxIntentRecord;
    resumedAt: Date;
    eventId: string;
  }): Promise<MutateWorkflowRunResult>;
  reconcileStepAttempt(input: {
    workspaceId: string;
    workflowId: string;
    runId: string;
    principalId: string;
    keyId: string;
    authorizationEvidenceRef: string;
    stepAttemptId: string;
    requestFingerprint: string;
    receipt: WorkflowRunMutationReceiptRecord;
    resolution:
      | {
          kind: "succeeded";
          providerOperationRef: string;
          providerMetadata: WorkflowStepProviderMetadata | null;
          outputs: Record<string, WorkflowRunArtifactReference>;
          finalSnapshot: WorkflowRunFinalSnapshot | null;
          finalSnapshotDigest: string | null;
          outboxIntent: WorkflowRunOutboxIntentRecord | null;
        }
      | {
          kind: "failed_known";
          providerOperationRef: string | null;
          failureCode: string;
          retryable: boolean;
          providerMetadata: WorkflowStepProviderMetadata | null;
          retryAt: Date | null;
          outboxIntent: WorkflowRunOutboxIntentRecord | null;
        };
    occurredAt: Date;
    eventIds: {
      generated: string[];
      reconciled: string;
      attemptCompleted: string | null;
      attemptFailed: string | null;
      retryScheduled: string | null;
      runCompleted: string | null;
      runFailed: string | null;
      runWaiting: string | null;
    };
  }): Promise<MutateWorkflowRunResult>;
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
  readonly providerResolution?: Omit<WorkflowRunProviderResolution, "stepId">;
  execute(input: WorkflowStepExecutionInput): Promise<WorkflowStepExecutionResult>;
  reconcile?(
    input: WorkflowStepReconciliationInput,
  ): Promise<WorkflowStepProviderResult>;
}

export interface WorkflowStepExecutionInput {
  workspaceId: string;
  runId: string;
  stepAttemptId: string;
  attempt: number;
  effectKey: string;
  intentDigest: string;
  snapshot: WorkflowRunStartSnapshot;
  step: ResolvedWorkflowDefinition["steps"][number];
  inputs: Record<string, ResolvedWorkflowStepInput>;
}

export interface WorkflowStepReconciliationInput {
  workspaceId: string;
  runId: string;
  stepAttemptId: string;
  attempt: number;
  effectKey: string;
  intentDigest: string;
  providerOperationRef: string | null;
  snapshot: WorkflowRunStartSnapshot;
  step: ResolvedWorkflowDefinition["steps"][number];
  inputs: Record<string, ResolvedWorkflowStepInput>;
}

export type WorkflowStepGeneratedOutput =
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
    };

export type WorkflowStepProviderMetadata = ArtifactProviderMetadata;

export interface WorkflowStepGeneratedResult {
  kind: "generated";
  providerOperationRef: string;
  outputs: Record<string, WorkflowStepGeneratedOutput>;
  providerMetadata?: WorkflowStepProviderMetadata;
}

export interface WorkflowStepFailedKnownResult {
  kind: "failed_known";
  failureCode: string;
  retryable: boolean;
  providerOperationRef: string | null;
  providerMetadata?: WorkflowStepProviderMetadata;
}

export interface WorkflowStepOutcomeUnknownResult {
  kind: "outcome_unknown";
  failureCode: string;
  providerOperationRef: string | null;
  providerMetadata?: WorkflowStepProviderMetadata;
}

export type WorkflowStepProviderResult =
  | WorkflowStepGeneratedResult
  | WorkflowStepFailedKnownResult
  | WorkflowStepOutcomeUnknownResult;

export type WorkflowStepExecutionResult =
  | { kind: "legacy"; output: Record<string, unknown> }
  | WorkflowStepProviderResult;

export interface ResolvedWorkflowStepInput {
  kind: ArtifactKind;
  contentDigest: string;
  artifactId: string | null;
  textContent: string | null;
  mediaType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  source?: WorkflowStepAttemptInput["source"];
  /** Runtime-only and populated only after the durable launch guard is prepared. */
  bytes?: Uint8Array;
}

export interface WorkflowStepExecutorRegistry {
  get(
    identity: string,
    contractDigest: string,
  ): WorkflowStepExecutor | undefined;
  resolve?(
    identity: string,
    contractDigest: string,
    config: Record<string, unknown>,
  ): WorkflowStepExecutor | undefined;
  getPinned?(
    identity: string,
    contractDigest: string,
    resolution: Omit<WorkflowRunProviderResolution, "stepId">,
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
  readArtifactBytes?(input: {
    workspaceId: string;
    artifactId: string;
  }): Promise<Uint8Array>;
  getGeneratedArtifact?(input: {
    workspaceId: string;
    effectKey: string;
    outputName: string;
  }): Promise<{
    artifact: ArtifactMetadata;
    textContent: string | null;
  } | null>;
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
      | "providerMetadata"
    > & { providerMetadata?: WorkflowStepProviderMetadata | null };
    lineageInputs: Array<
      Omit<
        import("../artifacts/types").ArtifactLineageInputRecord,
        "workspaceId" | "artifactId" | "position"
      >
    >;
  }): Promise<ArtifactMetadata>;
}
