import { randomUUID } from "node:crypto";
import { canonicalDigest } from "@/lib/agent-tools/canonical";
import { AutomationMaterializationError, AutomationServiceError } from "./errors";
import { validateAutomationRevision } from "./validation";
import type {
  AutomationClock,
  AutomationCursorCodec,
  AutomationDto,
  AutomationEventDto,
  AutomationEventRecord,
  AutomationMaterializationAuthorizationPort,
  AutomationMutationCapability,
  AutomationMutationReceiptRecord,
  AutomationOccurrenceCancellationDto,
  AutomationOccurrenceDto,
  AutomationOccurrenceRecord,
  AutomationOutboxIntentRecord,
  AutomationPage,
  AutomationReferencePort,
  AutomationRepository,
  AutomationRevisionDto,
  AutomationRevisionInput,
  AutomationStageAttemptRecord,
  AutomationWorkflowCancellationPort,
  AutomationWorkflowMaterializerPort,
  AutomationWorkflowObserverPort,
} from "./types";

export interface AutomationActor {
  principalId: string;
  keyId: string;
  authorizationEvidenceRef: string;
}

export interface AutomationServiceDependencies {
  repository: AutomationRepository;
  references: AutomationReferencePort;
  cursor: AutomationCursorCodec;
  authorization: AutomationMaterializationAuthorizationPort;
  materializer: AutomationWorkflowMaterializerPort;
  cancellation: AutomationWorkflowCancellationPort;
  observer: AutomationWorkflowObserverPort;
  clock?: AutomationClock;
  idFactory?: () => string;
}

const terminalStates = new Set(["succeeded", "failed", "cancelled", "skipped"]);
const iso = (value: Date | null) => value?.toISOString() ?? null;
const sorted = (values: string[]) => [...new Set(values)].sort((a, b) => a.localeCompare(b));

function automationDto(record: Awaited<ReturnType<AutomationRepository["getAutomation"]>> & {}) : AutomationDto {
  const { createdByPrincipalId: _createdBy, createdAt, updatedAt, ...rest } = record;
  return { ...rest, createdAt: createdAt.toISOString(), updatedAt: updatedAt.toISOString() };
}

function revisionDto(record: NonNullable<Awaited<ReturnType<AutomationRepository["getRevision"]>>>): AutomationRevisionDto {
  const { authorPrincipalId: _author, authorKeyId: _key, creationAuthorizationEvidenceRef: _evidence, createdAt, ...rest } = record;
  return { ...rest, createdAt: createdAt.toISOString() };
}

function occurrenceDto(record: AutomationOccurrenceRecord): AutomationOccurrenceDto {
  const {
    requestingPrincipalId: _principal,
    requestingKeyId: _key,
    invocationAuthorizationEvidenceRef: _evidence,
    acceptedAt,
    startedAt,
    completedAt,
    updatedAt,
    cancelRequestedAt,
    trigger,
    ...rest
  } = record;
  return {
    ...rest,
    trigger: { kind: trigger.kind, inputDigest: trigger.inputDigest },
    acceptedAt: acceptedAt.toISOString(),
    startedAt: iso(startedAt),
    completedAt: iso(completedAt),
    updatedAt: updatedAt.toISOString(),
    cancelRequestedAt: iso(cancelRequestedAt),
  };
}

function eventDto(record: AutomationEventRecord): AutomationEventDto {
  return { ...record, occurredAt: record.occurredAt.toISOString() };
}

function receipt(input: {
  workspaceId: string;
  actor: AutomationActor;
  capability: AutomationMutationCapability;
  idempotencyKey: string;
  requestFingerprint: string;
  resourceId: string;
  now: Date;
}): AutomationMutationReceiptRecord {
  return {
    workspaceId: input.workspaceId,
    principalId: input.actor.principalId,
    keyId: input.actor.keyId,
    authorizationEvidenceRef: input.actor.authorizationEvidenceRef,
    capability: input.capability,
    idempotencyKey: input.idempotencyKey,
    requestFingerprint: input.requestFingerprint,
    resourceId: input.resourceId,
    createdAt: input.now,
  };
}

function outbox(input: {
  id: string;
  workspaceId: string;
  automationId: string;
  occurrenceId: string;
  purpose: AutomationOutboxIntentRecord["purpose"];
  now: Date;
}): AutomationOutboxIntentRecord {
  return {
    schema: "automation-outbox-intent/v1",
    id: input.id,
    workspaceId: input.workspaceId,
    automationId: input.automationId,
    occurrenceId: input.occurrenceId,
    purpose: input.purpose,
    generation: 1,
    dedupeKey: `${input.purpose}:v1:${input.occurrenceId}`,
    state: "pending",
    availableAt: input.now,
    claimToken: null,
    claimedAt: null,
    deliveryAttempts: 0,
    deliveredAt: null,
    cancelledAt: null,
  };
}

function commitError(kind: "conflict" | "stale" | "unavailable"): never {
  if (kind === "conflict") throw new AutomationServiceError("IDEMPOTENCY_CONFLICT", "The idempotency key is already bound to different input.");
  if (kind === "stale") throw new AutomationServiceError("AUTOMATION_STALE_CONTROL_VERSION", "Automation state changed concurrently.");
  throw new AutomationServiceError("AUTOMATION_PERSISTENCE_UNAVAILABLE", "Automation state could not be committed.");
}

function committed<T>(result: import("./types").AutomationCommitResult<T>): T {
  if (result.kind === "created" || result.kind === "replayed") return result.value;
  return commitError(result.kind);
}

export class AutomationService {
  private readonly clock: AutomationClock;
  private readonly id: () => string;

  constructor(private readonly deps: AutomationServiceDependencies) {
    this.clock = deps.clock ?? { now: () => new Date() };
    this.id = deps.idFactory ?? randomUUID;
  }

  async validateRevision(input: { workspaceId: string; draft: unknown }) {
    return validateAutomationRevision(input.draft, { workspaceId: input.workspaceId, references: this.deps.references });
  }

  async createAutomation(input: { workspaceId: string; actor: AutomationActor; idempotencyKey: string }): Promise<AutomationDto> {
    const now = this.clock.now(); const automationId = this.id();
    const fingerprint = canonicalDigest({ workspaceId: input.workspaceId, capability: "automations.create@1" });
    const record = {
      schema: "automation/v1" as const,
      id: automationId,
      workspaceId: input.workspaceId,
      controlState: "active" as const,
      activeRevisionId: null,
      activeRevision: null,
      controlVersion: 1,
      nextRevision: 1,
      nextEventSequence: 1,
      createdByPrincipalId: input.actor.principalId,
      createdAt: now,
      updatedAt: now,
    };
    const event: AutomationEventRecord = { schema: "automation-event/v1", id: this.id(), workspaceId: input.workspaceId, automationId, sequence: 1, type: "automation.created", occurrenceId: null, revisionId: null, evidence: { controlVersion: 1 }, occurredAt: now };
    const result = await this.deps.repository.createAutomation({ automation: record, event, receipt: receipt({ workspaceId: input.workspaceId, actor: input.actor, capability: "automations.create@1", idempotencyKey: input.idempotencyKey, requestFingerprint: fingerprint, resourceId: automationId, now }) });
    return automationDto(committed(result));
  }

  private async ownedAutomation(workspaceId: string, automationId: string, principalId: string) {
    const automation = await this.deps.repository.getAutomation(workspaceId, automationId);
    if (!automation || automation.createdByPrincipalId !== principalId) throw new AutomationServiceError("AUTOMATION_NOT_FOUND", "Automation is unavailable.");
    return automation;
  }

  async getAutomation(input: { workspaceId: string; automationId: string; principalId: string }) {
    return automationDto(await this.ownedAutomation(input.workspaceId, input.automationId, input.principalId));
  }

  async getRevision(input: { workspaceId: string; automationId: string; revisionId: string; principalId: string }) {
    await this.ownedAutomation(input.workspaceId, input.automationId, input.principalId);
    const revision = await this.deps.repository.getRevision(input.workspaceId, input.automationId, input.revisionId);
    if (!revision) throw new AutomationServiceError("AUTOMATION_REVISION_NOT_FOUND", "Automation Revision is unavailable.");
    return revisionDto(revision);
  }

  async createRevision(input: { workspaceId: string; actor: AutomationActor; idempotencyKey: string; draft: AutomationRevisionInput }): Promise<AutomationRevisionDto> {
    const automation = await this.ownedAutomation(input.workspaceId, input.draft.automationId, input.actor.principalId);
    const validation = await this.validateRevision({ workspaceId: input.workspaceId, draft: input.draft });
    if (!validation.valid || !validation.normalizedDefinition || !validation.definitionDigest || !validation.referenceSnapshot) {
      const unsupported = validation.errors.some((entry) => entry.code === "AUTOMATION_TRIGGER_NOT_SUPPORTED");
      throw new AutomationServiceError(unsupported ? "AUTOMATION_TRIGGER_NOT_SUPPORTED" : "AUTOMATION_REVISION_INVALID", "Automation Revision is invalid.", { errors: validation.errors });
    }
    const now = this.clock.now(); const revisionId = this.id();
    const fingerprint = canonicalDigest(validation.normalizedDefinition);
    const { automationId: _automationId, ...definition } = validation.normalizedDefinition;
    const revision = { schema: "automation-revision/v1" as const, id: revisionId, workspaceId: input.workspaceId, automationId: automation.id, revision: automation.nextRevision, definitionDigest: validation.definitionDigest, definition, workflowResourceIds: validation.workflowResourceIds, artifactResourceIds: validation.artifactResourceIds, referenceSnapshot: validation.referenceSnapshot, authorPrincipalId: input.actor.principalId, authorKeyId: input.actor.keyId, creationAuthorizationEvidenceRef: input.actor.authorizationEvidenceRef, createdAt: now };
    const event: AutomationEventRecord = { schema: "automation-event/v1", id: this.id(), workspaceId: input.workspaceId, automationId: automation.id, sequence: automation.nextEventSequence, type: "automation.revision_created", occurrenceId: null, revisionId, evidence: { revision: revision.revision, definitionDigest: revision.definitionDigest }, occurredAt: now };
    const result = await this.deps.repository.createRevision({ automationId: automation.id, expectedNextRevision: automation.nextRevision, revision, event, receipt: receipt({ workspaceId: input.workspaceId, actor: input.actor, capability: "automation_revisions.create@1", idempotencyKey: input.idempotencyKey, requestFingerprint: fingerprint, resourceId: revisionId, now }) });
    return revisionDto(committed(result).revision);
  }

  async activateRevision(input: { workspaceId: string; automationId: string; revisionId: string; expectedControlVersion: number; expectedWorkflowId: string; expectedWorkflowRevisionId: string; expectedWorkflowDefinitionDigest: string; expectedArtifactIds: string[]; actor: AutomationActor; idempotencyKey: string }) {
    const automation = await this.ownedAutomation(input.workspaceId, input.automationId, input.actor.principalId);
    const revision = await this.deps.repository.getRevision(input.workspaceId, input.automationId, input.revisionId);
    if (!revision) throw new AutomationServiceError("AUTOMATION_REVISION_NOT_FOUND", "Automation Revision is unavailable.");
    if (revision.definition.action.workflow.workflowId !== input.expectedWorkflowId || revision.definition.action.workflow.revisionId !== input.expectedWorkflowRevisionId || revision.definition.action.workflow.definitionDigest !== input.expectedWorkflowDefinitionDigest || canonicalDigest(sorted(revision.artifactResourceIds)) !== canonicalDigest(sorted(input.expectedArtifactIds))) throw new AutomationServiceError("AUTOMATION_REFERENCE_STALE", "Activation resource assertions do not match the immutable Revision.");
    const revalidated = await this.validateRevision({ workspaceId: input.workspaceId, draft: { ...revision.definition, automationId: input.automationId } });
    if (!revalidated.valid || revalidated.definitionDigest !== revision.definitionDigest || canonicalDigest(revalidated.referenceSnapshot) !== canonicalDigest(revision.referenceSnapshot)) throw new AutomationServiceError("AUTOMATION_REFERENCE_STALE", "The immutable Workflow or Artifact references changed.");
    const now = this.clock.now(); const activationId = this.id(); const fingerprint = canonicalDigest({ automationId: input.automationId, revisionId: input.revisionId, expectedControlVersion: input.expectedControlVersion, expectedWorkflowId: input.expectedWorkflowId, expectedWorkflowRevisionId: input.expectedWorkflowRevisionId, expectedWorkflowDefinitionDigest: input.expectedWorkflowDefinitionDigest, expectedArtifactIds: sorted(input.expectedArtifactIds) });
    const activation = { schema: "automation-revision-activation/v1" as const, id: activationId, workspaceId: input.workspaceId, automationId: input.automationId, revisionId: revision.id, revision: revision.revision, priorRevisionId: automation.activeRevisionId, actorPrincipalId: input.actor.principalId, actorKeyId: input.actor.keyId, authorizationEvidenceRef: input.actor.authorizationEvidenceRef, activatedAt: now };
    const event: AutomationEventRecord = { schema: "automation-event/v1", id: this.id(), workspaceId: input.workspaceId, automationId: input.automationId, sequence: automation.nextEventSequence, type: "automation.revision_activated", occurrenceId: null, revisionId: revision.id, evidence: { revision: revision.revision, priorRevisionId: automation.activeRevisionId, controlVersion: automation.controlVersion + 1 }, occurredAt: now };
    const result = await this.deps.repository.activateRevision({ automationId: input.automationId, expectedControlVersion: input.expectedControlVersion, activation, event, receipt: receipt({ workspaceId: input.workspaceId, actor: input.actor, capability: "automation_revisions.activate@1", idempotencyKey: input.idempotencyKey, requestFingerprint: fingerprint, resourceId: activationId, now }) });
    const value = committed(result);
    return { automation: automationDto(value.automation), revision: revisionDto(value.revision) };
  }

  async invoke(input: { workspaceId: string; automationId: string; expectedRevisionId: string; expectedWorkflowId: string; expectedWorkflowRevisionId: string; expectedArtifactIds: string[]; triggerInputs: Record<string, string>; actor: AutomationActor; idempotencyKey: string }): Promise<AutomationOccurrenceDto> {
    const requestFingerprint = canonicalDigest({ automationId: input.automationId, expectedRevisionId: input.expectedRevisionId, expectedWorkflowId: input.expectedWorkflowId, expectedWorkflowRevisionId: input.expectedWorkflowRevisionId, expectedArtifactIds: sorted(input.expectedArtifactIds), triggerInputs: input.triggerInputs });
    const prior = await this.deps.repository.getOccurrenceBySourceKey(input.workspaceId, input.automationId, input.idempotencyKey);
    if (prior) {
      if (prior.requestingPrincipalId !== input.actor.principalId || prior.requestFingerprint !== requestFingerprint) throw new AutomationServiceError("IDEMPOTENCY_CONFLICT", "The source occurrence key is unavailable.");
      return occurrenceDto(prior);
    }
    const automation = await this.ownedAutomation(input.workspaceId, input.automationId, input.actor.principalId);
    if (automation.controlState !== "active") throw new AutomationServiceError("AUTOMATION_NOT_ACTIVE", "Automation is not active.");
    if (!automation.activeRevisionId) throw new AutomationServiceError("NO_ACTIVE_AUTOMATION_REVISION", "Automation has no active Revision.");
    const revision = await this.deps.repository.getRevision(input.workspaceId, input.automationId, automation.activeRevisionId);
    if (!revision) throw new AutomationServiceError("AUTOMATION_REFERENCE_STALE", "The active Revision is unavailable.");
    if (revision.id !== input.expectedRevisionId || revision.definition.action.workflow.workflowId !== input.expectedWorkflowId || revision.definition.action.workflow.revisionId !== input.expectedWorkflowRevisionId || canonicalDigest(sorted(revision.artifactResourceIds)) !== canonicalDigest(sorted(input.expectedArtifactIds))) throw new AutomationServiceError("AUTOMATION_REFERENCE_STALE", "Invocation resource assertions do not match the active Revision.");
    const now = this.clock.now(); const occurrenceId = this.id();
    const occurrence: AutomationOccurrenceRecord = { schema: "automation-occurrence/v1", id: occurrenceId, workspaceId: input.workspaceId, automationId: input.automationId, automationRevisionId: revision.id, automationRevision: revision.revision, automationRevisionDigest: revision.definitionDigest, sourceOccurrenceKey: input.idempotencyKey, requestFingerprint, trigger: { kind: "explicit_command", inputDigest: canonicalDigest(input.triggerInputs), inputs: structuredClone(input.triggerInputs) }, desiredState: "run", state: "queued", stage: "accepted", requestingPrincipalId: input.actor.principalId, requestingKeyId: input.actor.keyId, invocationAuthorizationEvidenceRef: input.actor.authorizationEvidenceRef, workflowId: revision.definition.action.workflow.workflowId, workflowRevisionId: revision.definition.action.workflow.revisionId, inputArtifactIds: revision.artifactResourceIds, workflowRunId: null, workflowRunStartSnapshotDigest: null, derivation: null, failureCode: null, cancelRequestedAt: null, acceptedAt: now, startedAt: null, completedAt: null, updatedAt: now };
    const event: AutomationEventRecord = { schema: "automation-event/v1", id: this.id(), workspaceId: input.workspaceId, automationId: input.automationId, sequence: automation.nextEventSequence, type: "occurrence.accepted", occurrenceId, revisionId: revision.id, evidence: { sourceOccurrenceKeyDigest: canonicalDigest(input.idempotencyKey), requestFingerprint }, occurredAt: now };
    const result = await this.deps.repository.invoke({ occurrence, event, receipt: receipt({ workspaceId: input.workspaceId, actor: input.actor, capability: "automations.invoke@1", idempotencyKey: input.idempotencyKey, requestFingerprint, resourceId: occurrenceId, now }), outbox: outbox({ id: this.id(), workspaceId: input.workspaceId, automationId: input.automationId, occurrenceId, purpose: "materialize_workflow", now }) });
    return occurrenceDto(committed(result));
  }

  async getOccurrence(input: { workspaceId: string; occurrenceId: string; principalId: string }) {
    const occurrence = await this.deps.repository.getOccurrence(input.workspaceId, input.occurrenceId);
    if (!occurrence || occurrence.requestingPrincipalId !== input.principalId) throw new AutomationServiceError("AUTOMATION_OCCURRENCE_NOT_FOUND", "Automation Occurrence is unavailable.");
    return occurrenceDto(occurrence);
  }

  async cancelOccurrence(input: { workspaceId: string; occurrenceId: string; actor: AutomationActor; idempotencyKey: string }): Promise<{ occurrence: AutomationOccurrenceDto; cancellation: AutomationOccurrenceCancellationDto }> {
    const occurrence = await this.deps.repository.getOccurrence(input.workspaceId, input.occurrenceId);
    if (!occurrence || occurrence.requestingPrincipalId !== input.actor.principalId) throw new AutomationServiceError("AUTOMATION_OCCURRENCE_NOT_FOUND", "Automation Occurrence is unavailable.");
    const now = this.clock.now(); const fingerprint = canonicalDigest({ occurrenceId: input.occurrenceId, desiredState: "cancel" });
    const result = await this.deps.repository.cancelOccurrence({ workspaceId: input.workspaceId, occurrenceId: input.occurrenceId, cancellationId: this.id(), eventId: this.id(), cancelledEventId: this.id(), cancellationOutbox: outbox({ id: this.id(), workspaceId: input.workspaceId, automationId: occurrence.automationId, occurrenceId: occurrence.id, purpose: "cancel_workflow", now }), requestingPrincipalId: input.actor.principalId, requestingKeyId: input.actor.keyId, authorizationEvidenceRef: input.actor.authorizationEvidenceRef, requestedAt: now, receipt: receipt({ workspaceId: input.workspaceId, actor: input.actor, capability: "automation_occurrences.cancel@1", idempotencyKey: input.idempotencyKey, requestFingerprint: fingerprint, resourceId: input.occurrenceId, now }) });
    const value = committed(result);
    const { requestingPrincipalId: _p, requestingKeyId: _k, authorizationEvidenceRef: _e, requestedAt, ...cancellation } = value.cancellation;
    return { occurrence: occurrenceDto(value.occurrence), cancellation: { ...cancellation, requestedAt: requestedAt.toISOString() } };
  }

  async retryOccurrence(input: { workspaceId: string; sourceOccurrenceId: string; actor: AutomationActor; idempotencyKey: string }): Promise<AutomationOccurrenceDto> {
    const source = await this.deps.repository.getOccurrence(input.workspaceId, input.sourceOccurrenceId);
    if (!source || source.requestingPrincipalId !== input.actor.principalId) throw new AutomationServiceError("AUTOMATION_OCCURRENCE_NOT_FOUND", "Automation Occurrence is unavailable.");
    const fingerprint = canonicalDigest({ sourceOccurrenceId: source.id, sourceState: source.state, workflowRunId: source.workflowRunId });
    const prior = await this.deps.repository.getOccurrenceBySourceKey(input.workspaceId, source.automationId, input.idempotencyKey);
    if (prior) {
      if (prior.requestingPrincipalId !== input.actor.principalId || prior.requestFingerprint !== fingerprint) throw new AutomationServiceError("IDEMPOTENCY_CONFLICT", "The source occurrence key is unavailable.");
      return occurrenceDto(prior);
    }
    if (source.state !== "failed" && source.state !== "cancelled") throw new AutomationServiceError("AUTOMATION_OCCURRENCE_NOT_RETRYABLE", "Only a terminal failed or cancelled Occurrence may be retried.");
    const now = this.clock.now(); const occurrenceId = this.id();
    const rootOccurrenceId = source.derivation?.rootOccurrenceId ?? source.id;
    const attempts = await this.deps.repository.getStageAttempts(input.workspaceId, source.id);
    const occurrence: AutomationOccurrenceRecord = { ...structuredClone(source), id: occurrenceId, sourceOccurrenceKey: input.idempotencyKey, requestFingerprint: fingerprint, desiredState: "run", state: source.workflowRunId ? "running" : "queued", stage: source.workflowRunId ? "workflow_running" : "accepted", requestingPrincipalId: input.actor.principalId, requestingKeyId: input.actor.keyId, invocationAuthorizationEvidenceRef: input.actor.authorizationEvidenceRef, derivation: { kind: "manual_retry", sourceOccurrenceId: source.id, rootOccurrenceId, sourceStageAttemptId: attempts.at(-1)?.id ?? null }, failureCode: null, cancelRequestedAt: null, acceptedAt: now, startedAt: source.workflowRunId ? now : null, completedAt: null, updatedAt: now };
    const automation = await this.ownedAutomation(input.workspaceId, source.automationId, input.actor.principalId);
    const event: AutomationEventRecord = { schema: "automation-event/v1", id: this.id(), workspaceId: input.workspaceId, automationId: source.automationId, sequence: automation.nextEventSequence, type: "occurrence.retry_derived", occurrenceId, revisionId: source.automationRevisionId, evidence: { sourceOccurrenceId: source.id, rootOccurrenceId, reusedWorkflowRun: source.workflowRunId !== null }, occurredAt: now };
    const result = await this.deps.repository.retryOccurrence({ sourceOccurrenceId: source.id, occurrence, event, receipt: receipt({ workspaceId: input.workspaceId, actor: input.actor, capability: "automation_occurrences.retry@1", idempotencyKey: input.idempotencyKey, requestFingerprint: fingerprint, resourceId: occurrenceId, now }), outbox: outbox({ id: this.id(), workspaceId: input.workspaceId, automationId: source.automationId, occurrenceId, purpose: source.workflowRunId ? "observe_workflow" : "materialize_workflow", now }) });
    return occurrenceDto(committed(result));
  }

  async processNextOutbox(input: { claimToken: string; claimExpiresBefore: Date }): Promise<"none" | "processed"> {
    const now = this.clock.now();
    const claimed = await this.deps.repository.claimOutbox({ now, claimExpiresBefore: input.claimExpiresBefore, claimToken: input.claimToken });
    if (claimed.kind === "none") return "none";
    const intent = claimed.intent;
    if (intent.purpose === "materialize_workflow") await this.materialize(intent, input.claimToken);
    else if (intent.purpose === "observe_workflow") await this.observe(intent, input.claimToken);
    else await this.cancelWorkflow(intent, input.claimToken);
    return "processed";
  }

  private async materialize(intent: AutomationOutboxIntentRecord, claimToken: string) {
    const now = this.clock.now(); const occurrence = await this.deps.repository.getOccurrence(intent.workspaceId, intent.occurrenceId);
    if (!occurrence) return;
    const automation = await this.deps.repository.getAutomation(intent.workspaceId, occurrence.automationId);
    if (!automation) return;
    if (occurrence.desiredState === "cancel") {
      const event: AutomationEventRecord = { schema: "automation-event/v1", id: this.id(), workspaceId: intent.workspaceId, automationId: occurrence.automationId, sequence: automation.nextEventSequence, type: "occurrence.cancelled", occurrenceId: occurrence.id, revisionId: occurrence.automationRevisionId, evidence: { workflowRunId: null }, occurredAt: now };
      await this.deps.repository.preventCancelledMaterialization({ outboxId: intent.id, claimToken, workspaceId: intent.workspaceId, occurrenceId: occurrence.id, event, occurredAt: now }); return;
    }
    const attempts = await this.deps.repository.getStageAttempts(intent.workspaceId, occurrence.id); const attemptNumber = attempts.length + 1;
    const effectKey = `automation-occurrence:${occurrence.id}:workflow:v1`;
    const attempt: AutomationStageAttemptRecord = { schema: "automation-stage-attempt/v1", id: this.id(), workspaceId: intent.workspaceId, automationId: occurrence.automationId, occurrenceId: occurrence.id, stage: "workflow_materialization", attempt: attemptNumber, effectKey, state: "running", workflowRunId: null, failureCode: null, startedAt: now, completedAt: null };
    const event: AutomationEventRecord = { schema: "automation-event/v1", id: this.id(), workspaceId: intent.workspaceId, automationId: occurrence.automationId, sequence: automation.nextEventSequence, type: "occurrence.materialization_started", occurrenceId: occurrence.id, revisionId: occurrence.automationRevisionId, evidence: { attempt: attemptNumber, effectKeyDigest: canonicalDigest(effectKey) }, occurredAt: now };
    const begun = await this.deps.repository.beginMaterialization({ outboxId: intent.id, claimToken, workspaceId: intent.workspaceId, occurrenceId: occurrence.id, expectedUpdatedAt: occurrence.updatedAt, attempt, event });
    if (begun.kind !== "created" && begun.kind !== "replayed") return;
    try {
      const authorization = await this.deps.authorization.checkCurrent({ workspaceId: intent.workspaceId, principalId: occurrence.requestingPrincipalId, keyId: occurrence.requestingKeyId, automationId: occurrence.automationId, workflowId: occurrence.workflowId, workflowRevisionId: occurrence.workflowRevisionId, artifactIds: occurrence.inputArtifactIds, evaluatedAt: now });
      if (!authorization) throw new AutomationMaterializationError("AUTOMATION_AUTHORIZATION_STALE", true);
      const revision = await this.deps.repository.getRevision(intent.workspaceId, occurrence.automationId, occurrence.automationRevisionId);
      if (!revision) throw new AutomationMaterializationError("AUTOMATION_REFERENCE_STALE", false);
      const run = await this.deps.materializer.startGoldenWorkflow({ workspaceId: intent.workspaceId, occurrenceId: occurrence.id, workflowId: occurrence.workflowId, workflowRevisionId: occurrence.workflowRevisionId, inputs: revision.definition.action.inputs.constants, inputArtifactIds: occurrence.inputArtifactIds, principalId: occurrence.requestingPrincipalId, keyId: occurrence.requestingKeyId, automationAuthorization: authorization, workflowRunIdempotencyKey: effectKey });
      const currentAutomation = await this.deps.repository.getAutomation(intent.workspaceId, occurrence.automationId);
      if (!currentAutomation) return;
      const boundEvent: AutomationEventRecord = { schema: "automation-event/v1", id: this.id(), workspaceId: intent.workspaceId, automationId: occurrence.automationId, sequence: currentAutomation.nextEventSequence, type: "occurrence.workflow_materialized", occurrenceId: occurrence.id, revisionId: occurrence.automationRevisionId, evidence: { workflowRunId: run.runId, startSnapshotDigest: run.startSnapshotDigest }, occurredAt: this.clock.now() };
      await this.deps.repository.bindWorkflowRun({ outboxId: intent.id, claimToken, workspaceId: intent.workspaceId, occurrenceId: occurrence.id, stageAttemptId: attempt.id, runId: run.runId, startSnapshotDigest: run.startSnapshotDigest, event: boundEvent, observationOutbox: outbox({ id: this.id(), workspaceId: intent.workspaceId, automationId: occurrence.automationId, occurrenceId: occurrence.id, purpose: "observe_workflow", now: this.clock.now() }), occurredAt: this.clock.now() });
    } catch (error) {
      const failure = error instanceof AutomationMaterializationError ? error : new AutomationMaterializationError("WORKFLOW_MATERIALIZATION_UNAVAILABLE", true);
      const revision = await this.deps.repository.getRevision(intent.workspaceId, occurrence.automationId, occurrence.automationRevisionId);
      const terminal = !failure.retryable || attemptNumber >= (revision?.definition.occurrencePolicy.maximumMaterializationAttempts ?? 1);
      const occurredAt = this.clock.now(); const currentAutomation = await this.deps.repository.getAutomation(intent.workspaceId, occurrence.automationId); if (!currentAutomation) return;
      const failedEvent: AutomationEventRecord = { schema: "automation-event/v1", id: this.id(), workspaceId: intent.workspaceId, automationId: occurrence.automationId, sequence: currentAutomation.nextEventSequence, type: "occurrence.materialization_failed", occurrenceId: occurrence.id, revisionId: occurrence.automationRevisionId, evidence: { attempt: attemptNumber, failureCode: failure.failureCode, terminal }, occurredAt };
      await this.deps.repository.failMaterialization({ outboxId: intent.id, claimToken, workspaceId: intent.workspaceId, occurrenceId: occurrence.id, stageAttemptId: attempt.id, failureCode: failure.failureCode, terminal, retryAt: terminal ? null : new Date(occurredAt.getTime() + Math.min(60, 2 ** attemptNumber) * 1_000), event: failedEvent, occurredAt });
    }
  }

  private async observe(intent: AutomationOutboxIntentRecord, claimToken: string) {
    const occurrence = await this.deps.repository.getOccurrence(intent.workspaceId, intent.occurrenceId); if (!occurrence?.workflowRunId) return;
    const state = await this.deps.observer.getRunState({ workspaceId: intent.workspaceId, workflowId: occurrence.workflowId, runId: occurrence.workflowRunId });
    const observedAt = this.clock.now();
    if (!state) { await this.deps.repository.releaseOutbox({ outboxId: intent.id, claimToken, availableAt: new Date(observedAt.getTime() + 5_000) }); return; }
    const terminal = state === "completed" || state === "failed" || state === "cancelled";
    const automation = await this.deps.repository.getAutomation(intent.workspaceId, occurrence.automationId);
    const terminalEvent: AutomationEventRecord | null = !terminal || !automation ? null : state === "completed" ? { schema: "automation-event/v1", id: this.id(), workspaceId: intent.workspaceId, automationId: occurrence.automationId, sequence: automation.nextEventSequence, type: "occurrence.succeeded", occurrenceId: occurrence.id, revisionId: occurrence.automationRevisionId, evidence: { workflowRunId: occurrence.workflowRunId }, occurredAt: observedAt } : state === "cancelled" ? { schema: "automation-event/v1", id: this.id(), workspaceId: intent.workspaceId, automationId: occurrence.automationId, sequence: automation.nextEventSequence, type: "occurrence.cancelled", occurrenceId: occurrence.id, revisionId: occurrence.automationRevisionId, evidence: { workflowRunId: occurrence.workflowRunId }, occurredAt: observedAt } : { schema: "automation-event/v1", id: this.id(), workspaceId: intent.workspaceId, automationId: occurrence.automationId, sequence: automation.nextEventSequence, type: "occurrence.failed", occurrenceId: occurrence.id, revisionId: occurrence.automationRevisionId, evidence: { workflowRunId: occurrence.workflowRunId, failureCode: "WORKFLOW_RUN_FAILED" }, occurredAt: observedAt };
    await this.deps.repository.settleWorkflowObservation({ outboxId: intent.id, claimToken, workspaceId: intent.workspaceId, occurrenceId: occurrence.id, runState: state, failureCode: state === "failed" ? "WORKFLOW_RUN_FAILED" : null, terminalEvent, retryAt: terminal ? null : new Date(observedAt.getTime() + 5_000), observedAt });
  }

  private async cancelWorkflow(intent: AutomationOutboxIntentRecord, claimToken: string) {
    const occurrence = await this.deps.repository.getOccurrence(intent.workspaceId, intent.occurrenceId); if (!occurrence) return;
    if (!occurrence.workflowRunId) { await this.deps.repository.releaseOutbox({ outboxId: intent.id, claimToken, availableAt: new Date(this.clock.now().getTime() + 2_000) }); return; }
    const now = this.clock.now();
    const result = await this.deps.cancellation.requestCancellation({ workspaceId: intent.workspaceId, workflowId: occurrence.workflowId, runId: occurrence.workflowRunId, source: { kind: "automation_occurrence", automationId: occurrence.automationId, occurrenceId: occurrence.id }, actor: { principalId: occurrence.requestingPrincipalId, keyId: occurrence.requestingKeyId }, requestedAt: now });
    await this.deps.repository.settleWorkflowCancellation({ outboxId: intent.id, claimToken, workspaceId: intent.workspaceId, occurrenceId: occurrence.id, result, retryAt: result === "unavailable" ? new Date(now.getTime() + 5_000) : null, occurredAt: now });
  }

  async listAutomations(input: { workspaceId: string; principalId: string; cursor?: string; limit?: number }): Promise<AutomationPage<AutomationDto>> {
    const limit = Math.min(100, Math.max(1, input.limit ?? 50)); const filterDigest = canonicalDigest({});
    const position = input.cursor ? this.deps.cursor.open({ cursor: input.cursor, workspaceId: input.workspaceId, principalId: input.principalId, kind: "automations", scopeId: input.workspaceId, filterDigest }) : null;
    const records = await this.deps.repository.listAutomations({ workspaceId: input.workspaceId, requestingPrincipalId: input.principalId, before: position ? { createdAt: new Date(position.primary), id: position.id } : undefined, limit: limit + 1 });
    const items = records.slice(0, limit); const hasMore = records.length > limit; const last = items.at(-1);
    return { items: items.map(automationDto), hasMore, nextCursor: hasMore && last ? this.deps.cursor.seal({ workspaceId: input.workspaceId, principalId: input.principalId, kind: "automations", scopeId: input.workspaceId, filterDigest, position: { primary: last.createdAt.toISOString(), id: last.id } }) : null };
  }

  async listRevisions(input: { workspaceId: string; automationId: string; principalId: string; cursor?: string; limit?: number }): Promise<AutomationPage<AutomationRevisionDto>> {
    await this.ownedAutomation(input.workspaceId, input.automationId, input.principalId); const limit = Math.min(100, Math.max(1, input.limit ?? 50)); const filterDigest = canonicalDigest({ automationId: input.automationId });
    const position = input.cursor ? this.deps.cursor.open({ cursor: input.cursor, workspaceId: input.workspaceId, principalId: input.principalId, kind: "revisions", scopeId: input.automationId, filterDigest }) : null;
    const records = await this.deps.repository.listRevisions({ workspaceId: input.workspaceId, automationId: input.automationId, requestingPrincipalId: input.principalId, before: position ? { revision: Number(position.primary), id: position.id } : undefined, limit: limit + 1 }); const items = records.slice(0, limit); const hasMore = records.length > limit; const last = items.at(-1);
    return { items: items.map(revisionDto), hasMore, nextCursor: hasMore && last ? this.deps.cursor.seal({ workspaceId: input.workspaceId, principalId: input.principalId, kind: "revisions", scopeId: input.automationId, filterDigest, position: { primary: String(last.revision), id: last.id } }) : null };
  }

  async listOccurrences(input: { workspaceId: string; automationId: string; principalId: string; cursor?: string; limit?: number }): Promise<AutomationPage<AutomationOccurrenceDto>> {
    await this.ownedAutomation(input.workspaceId, input.automationId, input.principalId); const limit = Math.min(100, Math.max(1, input.limit ?? 50)); const filterDigest = canonicalDigest({ automationId: input.automationId });
    const position = input.cursor ? this.deps.cursor.open({ cursor: input.cursor, workspaceId: input.workspaceId, principalId: input.principalId, kind: "occurrences", scopeId: input.automationId, filterDigest }) : null;
    const records = await this.deps.repository.listOccurrences({ workspaceId: input.workspaceId, automationId: input.automationId, requestingPrincipalId: input.principalId, before: position ? { acceptedAt: new Date(position.primary), id: position.id } : undefined, limit: limit + 1 }); const items = records.slice(0, limit); const hasMore = records.length > limit; const last = items.at(-1);
    return { items: items.map(occurrenceDto), hasMore, nextCursor: hasMore && last ? this.deps.cursor.seal({ workspaceId: input.workspaceId, principalId: input.principalId, kind: "occurrences", scopeId: input.automationId, filterDigest, position: { primary: last.acceptedAt.toISOString(), id: last.id } }) : null };
  }

  async listEvents(input: { workspaceId: string; automationId: string; principalId: string; cursor?: string; limit?: number }): Promise<AutomationPage<AutomationEventDto>> {
    await this.ownedAutomation(input.workspaceId, input.automationId, input.principalId); const limit = Math.min(100, Math.max(1, input.limit ?? 50)); const filterDigest = canonicalDigest({ automationId: input.automationId });
    const position = input.cursor ? this.deps.cursor.open({ cursor: input.cursor, workspaceId: input.workspaceId, principalId: input.principalId, kind: "events", scopeId: input.automationId, filterDigest }) : null;
    const records = await this.deps.repository.listEvents({ workspaceId: input.workspaceId, automationId: input.automationId, requestingPrincipalId: input.principalId, afterSequence: position ? Number(position.primary) : 0, limit: limit + 1 }); const items = records.slice(0, limit); const hasMore = records.length > limit; const last = items.at(-1);
    return { items: items.map(eventDto), hasMore, nextCursor: hasMore && last ? this.deps.cursor.seal({ workspaceId: input.workspaceId, principalId: input.principalId, kind: "events", scopeId: input.automationId, filterDigest, position: { primary: String(last.sequence), id: last.id } }) : null };
  }
}
