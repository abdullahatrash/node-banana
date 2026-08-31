export type AutomationControlState = "active" | "paused" | "retired";
export type AutomationOccurrenceState =
  | "queued"
  | "running"
  | "waiting"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "skipped";
export type AutomationOccurrenceStage =
  | "accepted"
  | "workflow_materialization"
  | "workflow_running"
  | "complete";

export interface ExplicitCommandTrigger {
  kind: "explicit_command";
}

/** Reserved for #173. #172 validation rejects this trigger family. */
export interface ScheduleTrigger {
  kind: "schedule";
  schedule: Record<string, unknown>;
}

/** Reserved for #174. #172 validation rejects this trigger family. */
export interface ExternalEventTrigger {
  kind: "external_event";
  connector: Record<string, unknown>;
}

export type AutomationTrigger =
  | ExplicitCommandTrigger
  | ScheduleTrigger
  | ExternalEventTrigger;

export type AutomationOverlapPolicy =
  | { mode: "queue" }
  | { mode: "skip" }
  | { mode: "parallel"; maximumConcurrency: number };

export interface AutomationWorkflowAction {
  kind: "start_workflow";
  workflow: {
    workflowId: string;
    revisionId: string;
    revision: number;
    definitionDigest: string;
  };
  inputs: {
    constants: Record<string, string>;
    artifactBindings: Record<string, string>;
  };
}

export interface AutomationRevisionInput {
  schema: "automation-revision-input/v1";
  automationId: string;
  trigger: AutomationTrigger;
  occurrencePolicy: {
    overlap: AutomationOverlapPolicy;
    maximumMaterializationAttempts: number;
  };
  action: AutomationWorkflowAction;
}

export interface AutomationRecord {
  schema: "automation/v1";
  id: string;
  workspaceId: string;
  controlState: AutomationControlState;
  activeRevisionId: string | null;
  activeRevision: number | null;
  controlVersion: number;
  nextRevision: number;
  nextEventSequence: number;
  createdByPrincipalId: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface AutomationRevisionRecord {
  schema: "automation-revision/v1";
  id: string;
  workspaceId: string;
  automationId: string;
  revision: number;
  definitionDigest: string;
  definition: Omit<AutomationRevisionInput, "automationId">;
  workflowResourceIds: string[];
  artifactResourceIds: string[];
  referenceSnapshot: {
    operationRegistryDigest: string;
    goldenWorkflowContractDigest: string;
    artifacts: Array<{ id: string; digest: string; kind: "image"; origin: "imported" }>;
  };
  authorPrincipalId: string;
  authorKeyId: string;
  creationAuthorizationEvidenceRef: string;
  createdAt: Date;
}

export interface AutomationRevisionActivationRecord {
  schema: "automation-revision-activation/v1";
  id: string;
  workspaceId: string;
  automationId: string;
  revisionId: string;
  revision: number;
  priorRevisionId: string | null;
  actorPrincipalId: string;
  actorKeyId: string;
  authorizationEvidenceRef: string;
  activatedAt: Date;
}

export interface AutomationOccurrenceDerivation {
  kind: "manual_retry";
  sourceOccurrenceId: string;
  rootOccurrenceId: string;
  sourceStageAttemptId: string | null;
}

export interface AutomationOccurrenceRecord {
  schema: "automation-occurrence/v1";
  id: string;
  workspaceId: string;
  automationId: string;
  automationRevisionId: string;
  automationRevision: number;
  automationRevisionDigest: string;
  /** Caller idempotency key for explicit invocation; globally unique per Automation. */
  sourceOccurrenceKey: string;
  requestFingerprint: string;
  trigger: {
    kind: "explicit_command";
    inputDigest: string;
    inputs: Record<string, string>;
  };
  desiredState: "run" | "cancel";
  state: AutomationOccurrenceState;
  stage: AutomationOccurrenceStage;
  requestingPrincipalId: string;
  requestingKeyId: string;
  invocationAuthorizationEvidenceRef: string;
  workflowId: string;
  workflowRevisionId: string;
  inputArtifactIds: string[];
  workflowRunId: string | null;
  workflowRunStartSnapshotDigest: string | null;
  derivation: AutomationOccurrenceDerivation | null;
  failureCode: string | null;
  cancelRequestedAt: Date | null;
  acceptedAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  updatedAt: Date;
}

export interface AutomationStageAttemptRecord {
  schema: "automation-stage-attempt/v1";
  id: string;
  workspaceId: string;
  automationId: string;
  occurrenceId: string;
  stage: "workflow_materialization";
  attempt: number;
  /** Stable across attempts; the canonical Run start idempotency key. */
  effectKey: string;
  state: "running" | "succeeded" | "failed";
  workflowRunId: string | null;
  failureCode: string | null;
  startedAt: Date;
  completedAt: Date | null;
}

export type AutomationEventType =
  | "automation.created"
  | "automation.revision_created"
  | "automation.revision_activated"
  | "occurrence.accepted"
  | "occurrence.materialization_started"
  | "occurrence.workflow_materialized"
  | "occurrence.materialization_failed"
  | "occurrence.cancellation_requested"
  | "occurrence.cancelled"
  | "occurrence.succeeded"
  | "occurrence.failed"
  | "occurrence.retry_derived";

interface AutomationEventBase<T extends AutomationEventType, E> {
  schema: "automation-event/v1";
  id: string;
  workspaceId: string;
  automationId: string;
  sequence: number;
  type: T;
  occurrenceId: string | null;
  revisionId: string | null;
  evidence: E;
  occurredAt: Date;
}

export type AutomationEventRecord =
  | AutomationEventBase<"automation.created", { controlVersion: number }>
  | AutomationEventBase<"automation.revision_created", { revision: number; definitionDigest: string }>
  | AutomationEventBase<"automation.revision_activated", { revision: number; priorRevisionId: string | null; controlVersion: number }>
  | AutomationEventBase<"occurrence.accepted", { sourceOccurrenceKeyDigest: string; requestFingerprint: string }>
  | AutomationEventBase<"occurrence.materialization_started", { attempt: number; effectKeyDigest: string }>
  | AutomationEventBase<"occurrence.workflow_materialized", { workflowRunId: string; startSnapshotDigest: string }>
  | AutomationEventBase<"occurrence.materialization_failed", { attempt: number; failureCode: string; terminal: boolean }>
  | AutomationEventBase<"occurrence.cancellation_requested", { disposition: "prevented" | "cancellation_requested" | "too_late"; workflowRunId: string | null }>
  | AutomationEventBase<"occurrence.cancelled", { workflowRunId: string | null }>
  | AutomationEventBase<"occurrence.succeeded", { workflowRunId: string }>
  | AutomationEventBase<"occurrence.failed", { workflowRunId: string; failureCode: string }>
  | AutomationEventBase<"occurrence.retry_derived", { sourceOccurrenceId: string; rootOccurrenceId: string; reusedWorkflowRun: boolean }>;

export type AutomationOutboxPurpose =
  | "materialize_workflow"
  | "observe_workflow"
  | "cancel_workflow";

export interface AutomationOutboxIntentRecord {
  schema: "automation-outbox-intent/v1";
  id: string;
  workspaceId: string;
  automationId: string;
  occurrenceId: string;
  purpose: AutomationOutboxPurpose;
  generation: number;
  dedupeKey: string;
  state: "pending" | "claimed" | "delivered" | "cancelled";
  availableAt: Date;
  claimToken: string | null;
  claimedAt: Date | null;
  deliveryAttempts: number;
  deliveredAt: Date | null;
  cancelledAt: Date | null;
}

export type AutomationMutationCapability =
  | "automations.create@1"
  | "automation_revisions.create@1"
  | "automation_revisions.activate@1"
  | "automations.invoke@1"
  | "automation_occurrences.cancel@1"
  | "automation_occurrences.retry@1";

export interface AutomationMutationReceiptRecord {
  workspaceId: string;
  principalId: string;
  keyId: string;
  authorizationEvidenceRef: string;
  capability: AutomationMutationCapability;
  idempotencyKey: string;
  requestFingerprint: string;
  resourceId: string;
  createdAt: Date;
}

export interface AutomationOccurrenceCancellationRecord {
  schema: "automation-occurrence-cancellation/v1";
  id: string;
  workspaceId: string;
  automationId: string;
  occurrenceId: string;
  requestingPrincipalId: string;
  requestingKeyId: string;
  authorizationEvidenceRef: string;
  disposition: "prevented" | "cancellation_requested" | "too_late";
  workflowRunId: string | null;
  rollbackGuaranteed: false;
  requestedAt: Date;
}

export interface AutomationRevisionValidationIssue {
  code: string;
  path: string;
  message: string;
}

export interface AutomationRevisionValidationResult {
  valid: boolean;
  errors: AutomationRevisionValidationIssue[];
  definitionDigest: string | null;
  normalizedDefinition: AutomationRevisionInput | null;
  workflowResourceIds: string[];
  artifactResourceIds: string[];
  referenceSnapshot: AutomationRevisionRecord["referenceSnapshot"] | null;
}

export interface AutomationWorkflowRevisionSnapshot {
  workflowId: string;
  revisionId: string;
  revision: number;
  definitionDigest: string;
  operationRegistryDigest: string;
  goldenWorkflow: {
    kind: "golden_linkedin_v1";
    contractDigest: string;
  } | null;
  inputNames: Array<{
    name: string;
    kind: "text" | "image";
    required: boolean;
  }>;
}

export interface AutomationArtifactSnapshot {
  id: string;
  digest: string;
  kind: "image" | "text" | "binary";
  origin: "imported" | "generated";
}

export interface AutomationReferencePort {
  getWorkflowRevision(input: {
    workspaceId: string;
    workflowId: string;
    revisionId: string;
  }): Promise<AutomationWorkflowRevisionSnapshot | null>;
  getArtifact(input: {
    workspaceId: string;
    artifactId: string;
  }): Promise<AutomationArtifactSnapshot | null>;
}

export interface AutomationMaterializationAuthorizationSession {
  id: string;
  workspaceId: string;
  principalId: string;
  keyId: string;
  capability: "automations.invoke@1";
  automationId: string;
  workflowId: string;
  workflowRevisionId: string;
  artifactIds: string[];
  evidenceRef: string;
  evidenceDigest: string;
  issuedAt: Date;
  expiresAt: Date;
}

export interface AutomationMaterializationAuthorizationPort {
  checkCurrent(input: {
    workspaceId: string;
    principalId: string;
    keyId: string;
    automationId: string;
    workflowId: string;
    workflowRevisionId: string;
    artifactIds: string[];
    evaluatedAt: Date;
  }): Promise<AutomationMaterializationAuthorizationSession | null>;
}

export interface AutomationWorkflowMaterializerPort {
  /**
   * Re-authorizes workflow_runs.start@2 for the retained actor and exact
   * Workflow/Artifact resources, then invokes the canonical WorkflowRunService.
   */
  startGoldenWorkflow(input: {
    workspaceId: string;
    occurrenceId: string;
    workflowId: string;
    workflowRevisionId: string;
    inputs: Record<string, string>;
    inputArtifactIds: string[];
    principalId: string;
    keyId: string;
    automationAuthorization: AutomationMaterializationAuthorizationSession;
    workflowRunIdempotencyKey: string;
  }): Promise<{
    runId: string;
    startSnapshotDigest: string;
    state: "accepted";
  }>;
}

export interface AutomationWorkflowCancellationPort {
  /** Creates/replays a durable canonical child Run cancellation request. */
  requestCancellation(input: {
    workspaceId: string;
    workflowId: string;
    runId: string;
    source: {
      kind: "automation_occurrence";
      automationId: string;
      occurrenceId: string;
    };
    actor: { principalId: string; keyId: string };
    requestedAt: Date;
  }): Promise<"accepted" | "too_late" | "unavailable">;
}

export interface AutomationWorkflowObserverPort {
  getRunState(input: {
    workspaceId: string;
    workflowId: string;
    runId: string;
  }): Promise<
    | "accepted"
    | "running"
    | "waiting"
    | "outcome_unknown"
    | "completed"
    | "failed"
    | "cancelled"
    | null
  >;
}

export type AutomationCommitResult<T> =
  | { kind: "created" | "replayed"; value: T }
  | { kind: "conflict" | "stale" | "unavailable" };

export interface AutomationRepository {
  getAutomation(
    workspaceId: string,
    automationId: string,
  ): Promise<AutomationRecord | null>;
  listAutomations(input: {
    workspaceId: string;
    requestingPrincipalId: string;
    before?: { createdAt: Date; id: string };
    limit: number;
  }): Promise<AutomationRecord[]>;
  getRevision(
    workspaceId: string,
    automationId: string,
    revisionId: string,
  ): Promise<AutomationRevisionRecord | null>;
  listRevisions(input: {
    workspaceId: string;
    automationId: string;
    requestingPrincipalId: string;
    before?: { revision: number; id: string };
    limit: number;
  }): Promise<AutomationRevisionRecord[]>;
  getOccurrence(
    workspaceId: string,
    occurrenceId: string,
  ): Promise<AutomationOccurrenceRecord | null>;
  getOccurrenceBySourceKey(
    workspaceId: string,
    automationId: string,
    sourceOccurrenceKey: string,
  ): Promise<AutomationOccurrenceRecord | null>;
  getCancellation(
    workspaceId: string,
    occurrenceId: string,
  ): Promise<AutomationOccurrenceCancellationRecord | null>;
  getStageAttempts(
    workspaceId: string,
    occurrenceId: string,
  ): Promise<AutomationStageAttemptRecord[]>;
  getMutationReceipt(input: {
    workspaceId: string;
    principalId: string;
    capability: AutomationMutationCapability;
    idempotencyKey: string;
  }): Promise<AutomationMutationReceiptRecord | null>;
  listOccurrences(input: {
    workspaceId: string;
    automationId: string;
    requestingPrincipalId: string;
    before?: { acceptedAt: Date; id: string };
    limit: number;
  }): Promise<AutomationOccurrenceRecord[]>;
  listEvents(input: {
    workspaceId: string;
    automationId: string;
    requestingPrincipalId: string;
    afterSequence: number;
    limit: number;
  }): Promise<AutomationEventRecord[]>;
  createAutomation(input: {
    automation: AutomationRecord;
    event: AutomationEventRecord;
    receipt: AutomationMutationReceiptRecord;
  }): Promise<AutomationCommitResult<AutomationRecord>>;
  createRevision(input: {
    automationId: string;
    expectedNextRevision: number;
    revision: AutomationRevisionRecord;
    event: AutomationEventRecord;
    receipt: AutomationMutationReceiptRecord;
  }): Promise<
    AutomationCommitResult<{
      automation: AutomationRecord;
      revision: AutomationRevisionRecord;
    }>
  >;
  activateRevision(input: {
    automationId: string;
    expectedControlVersion: number;
    activation: AutomationRevisionActivationRecord;
    event: AutomationEventRecord;
    receipt: AutomationMutationReceiptRecord;
  }): Promise<
    AutomationCommitResult<{
      automation: AutomationRecord;
      revision: AutomationRevisionRecord;
      activation: AutomationRevisionActivationRecord;
    }>
  >;
  invoke(input: {
    occurrence: AutomationOccurrenceRecord;
    event: AutomationEventRecord;
    receipt: AutomationMutationReceiptRecord;
    outbox: AutomationOutboxIntentRecord;
  }): Promise<AutomationCommitResult<AutomationOccurrenceRecord>>;
  beginMaterialization(input: {
    outboxId: string;
    claimToken: string;
    workspaceId: string;
    occurrenceId: string;
    expectedUpdatedAt: Date;
    attempt: AutomationStageAttemptRecord;
    event: AutomationEventRecord;
  }): Promise<
    AutomationCommitResult<{
      occurrence: AutomationOccurrenceRecord;
      attempt: AutomationStageAttemptRecord;
    }>
  >;
  bindWorkflowRun(input: {
    outboxId: string;
    claimToken: string;
    workspaceId: string;
    occurrenceId: string;
    stageAttemptId: string;
    runId: string;
    startSnapshotDigest: string;
    event: AutomationEventRecord;
    observationOutbox: AutomationOutboxIntentRecord;
    occurredAt: Date;
  }): Promise<AutomationCommitResult<AutomationOccurrenceRecord>>;
  failMaterialization(input: {
    outboxId: string;
    claimToken: string;
    workspaceId: string;
    occurrenceId: string;
    stageAttemptId: string;
    failureCode: string;
    terminal: boolean;
    retryAt: Date | null;
    event: AutomationEventRecord;
    occurredAt: Date;
  }): Promise<AutomationCommitResult<AutomationOccurrenceRecord>>;
  cancelOccurrence(input: {
    workspaceId: string;
    occurrenceId: string;
    cancellationId: string;
    eventId: string;
    cancelledEventId: string;
    cancellationOutbox: AutomationOutboxIntentRecord | null;
    requestingPrincipalId: string;
    requestingKeyId: string;
    authorizationEvidenceRef: string;
    requestedAt: Date;
    receipt: AutomationMutationReceiptRecord;
  }): Promise<AutomationCommitResult<{
    occurrence: AutomationOccurrenceRecord;
    cancellation: AutomationOccurrenceCancellationRecord;
  }>>;
  retryOccurrence(input: {
    sourceOccurrenceId: string;
    occurrence: AutomationOccurrenceRecord;
    event: AutomationEventRecord;
    receipt: AutomationMutationReceiptRecord;
    outbox: AutomationOutboxIntentRecord;
  }): Promise<AutomationCommitResult<AutomationOccurrenceRecord>>;
  claimOutbox(input: {
    now: Date;
    claimExpiresBefore: Date;
    claimToken: string;
  }): Promise<
    | { kind: "claimed"; intent: AutomationOutboxIntentRecord }
    | { kind: "none" }
  >;
  releaseOutbox(input: {
    outboxId: string;
    claimToken: string;
    availableAt: Date;
  }): Promise<boolean>;
  settleWorkflowObservation(input: {
    outboxId: string;
    claimToken: string;
    workspaceId: string;
    occurrenceId: string;
    runState:
      | "accepted"
      | "running"
      | "waiting"
      | "outcome_unknown"
      | "completed"
      | "failed"
      | "cancelled";
    failureCode: string | null;
    terminalEvent: AutomationEventRecord | null;
    retryAt: Date | null;
    observedAt: Date;
  }): Promise<AutomationCommitResult<AutomationOccurrenceRecord>>;
  settleWorkflowCancellation(input: {
    outboxId: string;
    claimToken: string;
    workspaceId: string;
    occurrenceId: string;
    result: "accepted" | "too_late" | "unavailable";
    retryAt: Date | null;
    occurredAt: Date;
  }): Promise<AutomationCommitResult<AutomationOccurrenceRecord>>;
  preventCancelledMaterialization(input: {
    outboxId: string;
    claimToken: string;
    workspaceId: string;
    occurrenceId: string;
    event: AutomationEventRecord;
    occurredAt: Date;
  }): Promise<AutomationCommitResult<AutomationOccurrenceRecord>>;
}

export interface AutomationClock {
  now(): Date;
}

export type AutomationCursorKind = "automations" | "revisions" | "occurrences" | "events";
export interface AutomationCursorPosition {
  primary: string;
  id: string;
}
export interface AutomationCursorCodec {
  seal(input: {
    workspaceId: string;
    principalId: string;
    kind: AutomationCursorKind;
    scopeId: string;
    filterDigest: string;
    position: AutomationCursorPosition;
  }): string;
  open(input: {
    cursor: string;
    workspaceId: string;
    principalId: string;
    kind: AutomationCursorKind;
    scopeId: string;
    filterDigest: string;
  }): AutomationCursorPosition;
}

export interface AutomationPage<T> {
  items: T[];
  nextCursor: string | null;
  hasMore: boolean;
}

export type AutomationDto = Omit<
  AutomationRecord,
  "createdByPrincipalId" | "createdAt" | "updatedAt"
> & { createdAt: string; updatedAt: string };
export type AutomationRevisionDto = Omit<
  AutomationRevisionRecord,
  | "authorPrincipalId"
  | "authorKeyId"
  | "creationAuthorizationEvidenceRef"
  | "createdAt"
> & { createdAt: string };
export type AutomationOccurrenceDto = Omit<
  AutomationOccurrenceRecord,
  | "requestingPrincipalId"
  | "requestingKeyId"
  | "invocationAuthorizationEvidenceRef"
  | "acceptedAt"
  | "startedAt"
  | "completedAt"
  | "updatedAt"
  | "cancelRequestedAt"
  | "trigger"
> & {
  trigger: { kind: "explicit_command"; inputDigest: string };
  acceptedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  updatedAt: string;
  cancelRequestedAt: string | null;
};
export type AutomationOccurrenceCancellationDto = Omit<
  AutomationOccurrenceCancellationRecord,
  | "requestingPrincipalId"
  | "requestingKeyId"
  | "authorizationEvidenceRef"
  | "requestedAt"
> & { requestedAt: string };
export type AutomationEventDto = Omit<AutomationEventRecord, "occurredAt"> & {
  occurredAt: string;
};
