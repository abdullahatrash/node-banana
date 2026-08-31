import type {
  AutomationCommitResult,
  AutomationEventRecord,
  AutomationMutationReceiptRecord,
  AutomationOccurrenceCancellationRecord,
  AutomationOccurrenceRecord,
  AutomationOutboxIntentRecord,
  AutomationRepository,
  AutomationRevisionActivationRecord,
  AutomationRevisionRecord,
  AutomationStageAttemptRecord,
  AutomationRecord,
} from "./types";

const clone = <T>(value: T): T => structuredClone(value);
const key = (...parts: string[]) => parts.join("\u0000");
const terminalStatesForMemory = new Set<AutomationOccurrenceRecord["state"]>([
  "succeeded",
  "failed",
  "cancelled",
  "skipped",
]);

export class MemoryAutomationRepository implements AutomationRepository {
  private automations = new Map<string, AutomationRecord>();
  private revisions = new Map<string, AutomationRevisionRecord>();
  private activations = new Map<string, AutomationRevisionActivationRecord>();
  private occurrences = new Map<string, AutomationOccurrenceRecord>();
  private sourceKeys = new Map<string, string>();
  private attempts = new Map<string, AutomationStageAttemptRecord>();
  private events = new Map<string, AutomationEventRecord[]>();
  private outbox = new Map<string, AutomationOutboxIntentRecord>();
  private receipts = new Map<string, AutomationMutationReceiptRecord>();
  private cancellations = new Map<string, AutomationOccurrenceCancellationRecord>();

  private receiptKey(receipt: Pick<AutomationMutationReceiptRecord, "workspaceId" | "principalId" | "capability" | "idempotencyKey">): string {
    return key(receipt.workspaceId, receipt.principalId, receipt.capability, receipt.idempotencyKey);
  }

  private replay<T>(receipt: AutomationMutationReceiptRecord, resolve: (resourceId: string) => T | null): AutomationCommitResult<T> | null {
    const existing = this.receipts.get(this.receiptKey(receipt));
    if (!existing) return null;
    if (existing.requestFingerprint !== receipt.requestFingerprint) return { kind: "conflict" };
    const value = resolve(existing.resourceId);
    return value ? { kind: "replayed", value: clone(value) } : { kind: "unavailable" };
  }

  private append(event: AutomationEventRecord): boolean {
    const automationKey = key(event.workspaceId, event.automationId);
    const automation = this.automations.get(automationKey);
    if (!automation || event.sequence !== automation.nextEventSequence) return false;
    this.events.set(automationKey, [...(this.events.get(automationKey) ?? []), clone(event)]);
    automation.nextEventSequence += 1;
    automation.updatedAt = new Date(event.occurredAt);
    return true;
  }

  async getAutomation(workspaceId: string, automationId: string) {
    const value = this.automations.get(key(workspaceId, automationId));
    return value ? clone(value) : null;
  }

  async listAutomations(input: { workspaceId: string; requestingPrincipalId: string; before?: { createdAt: Date; id: string }; limit: number }) {
    return [...this.automations.values()]
      .filter((item) => item.workspaceId === input.workspaceId && item.createdByPrincipalId === input.requestingPrincipalId)
      .filter((item) => !input.before || item.createdAt < input.before.createdAt || (item.createdAt.getTime() === input.before.createdAt.getTime() && item.id < input.before.id))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id))
      .slice(0, input.limit)
      .map(clone);
  }

  async getRevision(workspaceId: string, automationId: string, revisionId: string) {
    const value = this.revisions.get(key(workspaceId, automationId, revisionId));
    return value ? clone(value) : null;
  }

  async listRevisions(input: { workspaceId: string; automationId: string; requestingPrincipalId: string; before?: { revision: number; id: string }; limit: number }) {
    const automation = this.automations.get(key(input.workspaceId, input.automationId));
    if (!automation || automation.createdByPrincipalId !== input.requestingPrincipalId) return [];
    return [...this.revisions.values()]
      .filter((item) => item.workspaceId === input.workspaceId && item.automationId === input.automationId)
      .filter((item) => !input.before || item.revision < input.before.revision || (item.revision === input.before.revision && item.id < input.before.id))
      .sort((a, b) => b.revision - a.revision || b.id.localeCompare(a.id))
      .slice(0, input.limit)
      .map(clone);
  }

  async getOccurrence(workspaceId: string, occurrenceId: string) {
    const value = this.occurrences.get(key(workspaceId, occurrenceId));
    return value ? clone(value) : null;
  }

  async getOccurrenceBySourceKey(workspaceId: string, automationId: string, sourceOccurrenceKey: string) {
    const id = this.sourceKeys.get(key(workspaceId, automationId, sourceOccurrenceKey));
    return id ? this.getOccurrence(workspaceId, id) : null;
  }

  async getCancellation(workspaceId: string, occurrenceId: string) {
    const value = this.cancellations.get(key(workspaceId, occurrenceId));
    return value ? clone(value) : null;
  }

  async getStageAttempts(workspaceId: string, occurrenceId: string) {
    return [...this.attempts.values()]
      .filter((item) => item.workspaceId === workspaceId && item.occurrenceId === occurrenceId)
      .sort((a, b) => a.attempt - b.attempt)
      .map(clone);
  }

  async getMutationReceipt(input: { workspaceId: string; principalId: string; capability: AutomationMutationReceiptRecord["capability"]; idempotencyKey: string }) {
    const value = this.receipts.get(this.receiptKey(input));
    return value ? clone(value) : null;
  }

  async listOccurrences(input: { workspaceId: string; automationId: string; requestingPrincipalId: string; before?: { acceptedAt: Date; id: string }; limit: number }) {
    return [...this.occurrences.values()]
      .filter((item) => item.workspaceId === input.workspaceId && item.automationId === input.automationId && item.requestingPrincipalId === input.requestingPrincipalId)
      .filter((item) => !input.before || item.acceptedAt < input.before.acceptedAt || (item.acceptedAt.getTime() === input.before.acceptedAt.getTime() && item.id < input.before.id))
      .sort((a, b) => b.acceptedAt.getTime() - a.acceptedAt.getTime() || b.id.localeCompare(a.id))
      .slice(0, input.limit)
      .map(clone);
  }

  async listEvents(input: { workspaceId: string; automationId: string; requestingPrincipalId: string; afterSequence: number; limit: number }) {
    const automation = this.automations.get(key(input.workspaceId, input.automationId));
    if (!automation || automation.createdByPrincipalId !== input.requestingPrincipalId) return [];
    return (this.events.get(key(input.workspaceId, input.automationId)) ?? [])
      .filter((item) => item.sequence > input.afterSequence)
      .slice(0, input.limit)
      .map(clone);
  }

  async createAutomation(input: { automation: AutomationRecord; event: AutomationEventRecord; receipt: AutomationMutationReceiptRecord }) {
    const replay = this.replay(input.receipt, (id) => this.automations.get(key(input.automation.workspaceId, id)) ?? null);
    if (replay) return replay;
    const automationKey = key(input.automation.workspaceId, input.automation.id);
    if (this.automations.has(automationKey)) return { kind: "conflict" } as const;
    this.automations.set(automationKey, clone(input.automation));
    if (!this.append(input.event)) { this.automations.delete(automationKey); return { kind: "unavailable" } as const; }
    this.receipts.set(this.receiptKey(input.receipt), clone(input.receipt));
    return { kind: "created", value: clone(this.automations.get(automationKey)!) } as const;
  }

  async createRevision(input: { automationId: string; expectedNextRevision: number; revision: AutomationRevisionRecord; event: AutomationEventRecord; receipt: AutomationMutationReceiptRecord }) {
    const replay = this.replay(input.receipt, (id) => {
      const revision = this.revisions.get(key(input.revision.workspaceId, input.automationId, id));
      const automation = this.automations.get(key(input.revision.workspaceId, input.automationId));
      return revision && automation ? { automation, revision } : null;
    });
    if (replay) return replay;
    const automation = this.automations.get(key(input.revision.workspaceId, input.automationId));
    if (!automation || automation.nextRevision !== input.expectedNextRevision || input.revision.revision !== input.expectedNextRevision) return { kind: "stale" } as const;
    if (this.revisions.has(key(input.revision.workspaceId, input.automationId, input.revision.id))) return { kind: "conflict" } as const;
    this.revisions.set(key(input.revision.workspaceId, input.automationId, input.revision.id), clone(input.revision));
    automation.nextRevision += 1;
    if (!this.append(input.event)) return { kind: "unavailable" } as const;
    this.receipts.set(this.receiptKey(input.receipt), clone(input.receipt));
    return { kind: "created", value: { automation: clone(automation), revision: clone(input.revision) } } as const;
  }

  async activateRevision(input: { automationId: string; expectedControlVersion: number; activation: AutomationRevisionActivationRecord; event: AutomationEventRecord; receipt: AutomationMutationReceiptRecord }) {
    const replay = this.replay(input.receipt, (id) => {
      const activation = this.activations.get(key(input.activation.workspaceId, id));
      const automation = this.automations.get(key(input.activation.workspaceId, input.automationId));
      const revision = activation ? this.revisions.get(key(input.activation.workspaceId, input.automationId, activation.revisionId)) : null;
      return activation && automation && revision ? { automation, revision, activation } : null;
    });
    if (replay) return replay;
    const automation = this.automations.get(key(input.activation.workspaceId, input.automationId));
    const revision = this.revisions.get(key(input.activation.workspaceId, input.automationId, input.activation.revisionId));
    if (!automation || !revision) return { kind: "unavailable" } as const;
    if (automation.controlVersion !== input.expectedControlVersion) return { kind: "stale" } as const;
    automation.activeRevisionId = revision.id; automation.activeRevision = revision.revision; automation.controlVersion += 1;
    this.activations.set(key(input.activation.workspaceId, input.activation.id), clone(input.activation));
    if (!this.append(input.event)) return { kind: "unavailable" } as const;
    this.receipts.set(this.receiptKey(input.receipt), clone(input.receipt));
    return { kind: "created", value: { automation: clone(automation), revision: clone(revision), activation: clone(input.activation) } } as const;
  }

  async invoke(input: { occurrence: AutomationOccurrenceRecord; event: AutomationEventRecord; receipt: AutomationMutationReceiptRecord; outbox: AutomationOutboxIntentRecord }) {
    const replay = this.replay(input.receipt, (id) => this.occurrences.get(key(input.occurrence.workspaceId, id)) ?? null);
    if (replay) return replay;
    const sourceKey = key(input.occurrence.workspaceId, input.occurrence.automationId, input.occurrence.sourceOccurrenceKey);
    const existingId = this.sourceKeys.get(sourceKey);
    if (existingId) {
      const existing = this.occurrences.get(key(input.occurrence.workspaceId, existingId));
      return existing?.requestFingerprint === input.occurrence.requestFingerprint ? { kind: "replayed", value: clone(existing) } as const : { kind: "conflict" } as const;
    }
    const automation = this.automations.get(key(input.occurrence.workspaceId, input.occurrence.automationId));
    if (!automation || automation.controlState !== "active" || automation.activeRevisionId !== input.occurrence.automationRevisionId) return { kind: "stale" } as const;
    this.occurrences.set(key(input.occurrence.workspaceId, input.occurrence.id), clone(input.occurrence));
    this.sourceKeys.set(sourceKey, input.occurrence.id); this.outbox.set(input.outbox.id, clone(input.outbox));
    if (!this.append(input.event)) return { kind: "unavailable" } as const;
    this.receipts.set(this.receiptKey(input.receipt), clone(input.receipt));
    return { kind: "created", value: clone(input.occurrence) } as const;
  }

  async beginMaterialization(input: { outboxId: string; claimToken: string; workspaceId: string; occurrenceId: string; expectedUpdatedAt: Date; attempt: AutomationStageAttemptRecord; event: AutomationEventRecord }) {
    const intent = this.outbox.get(input.outboxId); const occurrence = this.occurrences.get(key(input.workspaceId, input.occurrenceId));
    if (!intent || intent.claimToken !== input.claimToken || intent.state !== "claimed" || !occurrence) return { kind: "stale" } as const;
    if (occurrence.updatedAt.getTime() !== input.expectedUpdatedAt.getTime() || occurrence.desiredState === "cancel") return { kind: "stale" } as const;
    occurrence.state = "running"; occurrence.stage = "workflow_materialization"; occurrence.startedAt ??= new Date(input.attempt.startedAt); occurrence.updatedAt = new Date(input.attempt.startedAt);
    this.attempts.set(key(input.workspaceId, input.attempt.id), clone(input.attempt));
    if (!this.append(input.event)) return { kind: "unavailable" } as const;
    return { kind: "created", value: { occurrence: clone(occurrence), attempt: clone(input.attempt) } } as const;
  }

  async bindWorkflowRun(input: { outboxId: string; claimToken: string; workspaceId: string; occurrenceId: string; stageAttemptId: string; runId: string; startSnapshotDigest: string; event: AutomationEventRecord; observationOutbox: AutomationOutboxIntentRecord; occurredAt: Date }) {
    const intent = this.outbox.get(input.outboxId); const occurrence = this.occurrences.get(key(input.workspaceId, input.occurrenceId)); const attempt = this.attempts.get(key(input.workspaceId, input.stageAttemptId));
    if (!intent || intent.state !== "claimed" || intent.claimToken !== input.claimToken || !occurrence || !attempt) return { kind: "stale" } as const;
    if (occurrence.workflowRunId && occurrence.workflowRunId !== input.runId) return { kind: "conflict" } as const;
    occurrence.workflowRunId = input.runId; occurrence.workflowRunStartSnapshotDigest = input.startSnapshotDigest; occurrence.state = "running"; occurrence.stage = "workflow_running"; occurrence.updatedAt = new Date(input.occurredAt);
    attempt.state = "succeeded"; attempt.workflowRunId = input.runId; attempt.completedAt = new Date(input.occurredAt);
    intent.state = "delivered"; intent.claimToken = null; intent.claimedAt = null; intent.deliveredAt = new Date(input.occurredAt);
    this.outbox.set(input.observationOutbox.id, clone(input.observationOutbox));
    if (!this.append(input.event)) return { kind: "unavailable" } as const;
    return { kind: "created", value: clone(occurrence) } as const;
  }

  async failMaterialization(input: { outboxId: string; claimToken: string; workspaceId: string; occurrenceId: string; stageAttemptId: string; failureCode: string; terminal: boolean; retryAt: Date | null; event: AutomationEventRecord; occurredAt: Date }) {
    const intent = this.outbox.get(input.outboxId); const occurrence = this.occurrences.get(key(input.workspaceId, input.occurrenceId)); const attempt = this.attempts.get(key(input.workspaceId, input.stageAttemptId));
    if (!intent || intent.state !== "claimed" || intent.claimToken !== input.claimToken || !occurrence || !attempt) return { kind: "stale" } as const;
    attempt.state = "failed"; attempt.failureCode = input.failureCode; attempt.completedAt = new Date(input.occurredAt);
    occurrence.failureCode = input.failureCode; occurrence.updatedAt = new Date(input.occurredAt);
    if (input.terminal) { occurrence.state = "failed"; occurrence.stage = "complete"; occurrence.completedAt = new Date(input.occurredAt); intent.state = "delivered"; intent.deliveredAt = new Date(input.occurredAt); }
    else { occurrence.state = "waiting"; intent.state = "pending"; intent.availableAt = new Date(input.retryAt!); }
    intent.claimToken = null; intent.claimedAt = null;
    if (!this.append(input.event)) return { kind: "unavailable" } as const;
    return { kind: "created", value: clone(occurrence) } as const;
  }

  async cancelOccurrence(input: { workspaceId: string; occurrenceId: string; cancellationId: string; eventId: string; cancelledEventId: string; cancellationOutbox: AutomationOutboxIntentRecord | null; requestingPrincipalId: string; requestingKeyId: string; authorizationEvidenceRef: string; requestedAt: Date; receipt: AutomationMutationReceiptRecord }) {
    const replay = this.replay(input.receipt, () => {
      const occurrence = this.occurrences.get(key(input.workspaceId, input.occurrenceId));
      const cancellation = this.cancellations.get(key(input.workspaceId, input.occurrenceId));
      return occurrence && cancellation ? { occurrence, cancellation } : null;
    });
    if (replay) return replay;
    const occurrence = this.occurrences.get(key(input.workspaceId, input.occurrenceId));
    const automation = occurrence ? this.automations.get(key(input.workspaceId, occurrence.automationId)) : null;
    if (!occurrence || !automation) return { kind: "unavailable" } as const;
    const terminal = ["succeeded", "failed", "cancelled", "skipped"].includes(occurrence.state);
    const queued = occurrence.state === "queued" && occurrence.workflowRunId === null;
    const disposition = terminal ? "too_late" : queued ? "prevented" : "cancellation_requested";
    const cancellation: AutomationOccurrenceCancellationRecord = { schema: "automation-occurrence-cancellation/v1", id: input.cancellationId, workspaceId: input.workspaceId, automationId: occurrence.automationId, occurrenceId: occurrence.id, requestingPrincipalId: input.requestingPrincipalId, requestingKeyId: input.requestingKeyId, authorizationEvidenceRef: input.authorizationEvidenceRef, disposition, workflowRunId: occurrence.workflowRunId, rollbackGuaranteed: false, requestedAt: new Date(input.requestedAt) };
    if (!terminal) { occurrence.desiredState = "cancel"; occurrence.cancelRequestedAt ??= new Date(input.requestedAt); occurrence.updatedAt = new Date(input.requestedAt); }
    if (queued) {
      occurrence.state = "cancelled"; occurrence.stage = "complete"; occurrence.completedAt = new Date(input.requestedAt);
      for (const intent of this.outbox.values()) if (intent.occurrenceId === occurrence.id && intent.purpose === "materialize_workflow" && (intent.state === "pending" || intent.state === "claimed")) { intent.state = "cancelled"; intent.claimToken = null; intent.claimedAt = null; intent.cancelledAt = new Date(input.requestedAt); }
    }
    if (input.cancellationOutbox && disposition === "cancellation_requested") this.outbox.set(input.cancellationOutbox.id, clone(input.cancellationOutbox));
    const event: AutomationEventRecord = { schema: "automation-event/v1", id: input.eventId, workspaceId: input.workspaceId, automationId: occurrence.automationId, sequence: automation.nextEventSequence, type: "occurrence.cancellation_requested", occurrenceId: occurrence.id, revisionId: occurrence.automationRevisionId, evidence: { disposition, workflowRunId: occurrence.workflowRunId }, occurredAt: new Date(input.requestedAt) };
    this.cancellations.set(key(input.workspaceId, occurrence.id), clone(cancellation));
    if (!this.append(event)) return { kind: "unavailable" } as const;
    if (queued) {
      const cancelledEvent: AutomationEventRecord = { schema: "automation-event/v1", id: input.cancelledEventId, workspaceId: input.workspaceId, automationId: occurrence.automationId, sequence: automation.nextEventSequence, type: "occurrence.cancelled", occurrenceId: occurrence.id, revisionId: occurrence.automationRevisionId, evidence: { workflowRunId: null }, occurredAt: new Date(input.requestedAt) };
      if (!this.append(cancelledEvent)) return { kind: "unavailable" } as const;
    }
    this.receipts.set(this.receiptKey(input.receipt), clone(input.receipt));
    return { kind: "created", value: { occurrence: clone(occurrence), cancellation: clone(cancellation) } } as const;
  }

  async retryOccurrence(input: { sourceOccurrenceId: string; occurrence: AutomationOccurrenceRecord; event: AutomationEventRecord; receipt: AutomationMutationReceiptRecord; outbox: AutomationOutboxIntentRecord }) {
    const replay = this.replay(input.receipt, (id) => this.occurrences.get(key(input.occurrence.workspaceId, id)) ?? null);
    if (replay) return replay;
    const source = this.occurrences.get(key(input.occurrence.workspaceId, input.sourceOccurrenceId));
    if (!source || !["failed", "cancelled"].includes(source.state)) return { kind: "stale" } as const;
    const sourceKey = key(input.occurrence.workspaceId, input.occurrence.automationId, input.occurrence.sourceOccurrenceKey);
    if (this.sourceKeys.has(sourceKey)) return { kind: "conflict" } as const;
    this.occurrences.set(key(input.occurrence.workspaceId, input.occurrence.id), clone(input.occurrence)); this.sourceKeys.set(sourceKey, input.occurrence.id); this.outbox.set(input.outbox.id, clone(input.outbox));
    if (!this.append(input.event)) return { kind: "unavailable" } as const;
    this.receipts.set(this.receiptKey(input.receipt), clone(input.receipt));
    return { kind: "created", value: clone(input.occurrence) } as const;
  }

  async claimOutbox(input: { now: Date; claimExpiresBefore: Date; claimToken: string }) {
    const eligible = [...this.outbox.values()].filter((item) =>
      (item.state === "pending" && item.availableAt <= input.now) ||
      (item.state === "claimed" && item.claimedAt !== null && item.claimedAt <= input.claimExpiresBefore),
    );
    const intent = eligible
      .filter((item) => {
        if (item.purpose !== "materialize_workflow") return true;
        const occurrence = this.occurrences.get(key(item.workspaceId, item.occurrenceId));
        if (!occurrence) return false;
        return ![...this.occurrences.values()].some((candidate) => {
          if (candidate.workspaceId !== occurrence.workspaceId || candidate.automationId !== occurrence.automationId || candidate.id === occurrence.id || terminalStatesForMemory.has(candidate.state)) return false;
          if (candidate.state === "running" || candidate.state === "waiting") return true;
          return candidate.state === "queued" && (candidate.acceptedAt < occurrence.acceptedAt || (candidate.acceptedAt.getTime() === occurrence.acceptedAt.getTime() && candidate.id < occurrence.id));
        });
      })
      .sort((a, b) => a.availableAt.getTime() - b.availableAt.getTime() || a.id.localeCompare(b.id))[0];
    if (!intent) return { kind: "none" } as const;
    intent.state = "claimed"; intent.claimToken = input.claimToken; intent.claimedAt = new Date(input.now); intent.deliveryAttempts += 1;
    return { kind: "claimed", intent: clone(intent) } as const;
  }

  async releaseOutbox(input: { outboxId: string; claimToken: string; availableAt: Date }) {
    const intent = this.outbox.get(input.outboxId);
    if (!intent || intent.state !== "claimed" || intent.claimToken !== input.claimToken) return false;
    intent.state = "pending"; intent.claimToken = null; intent.claimedAt = null; intent.availableAt = new Date(input.availableAt); return true;
  }

  async settleWorkflowObservation(input: { outboxId: string; claimToken: string; workspaceId: string; occurrenceId: string; runState: "accepted" | "running" | "waiting" | "outcome_unknown" | "completed" | "failed" | "cancelled"; failureCode: string | null; terminalEvent: AutomationEventRecord | null; retryAt: Date | null; observedAt: Date }) {
    const intent = this.outbox.get(input.outboxId); const occurrence = this.occurrences.get(key(input.workspaceId, input.occurrenceId));
    if (!intent || intent.state !== "claimed" || intent.claimToken !== input.claimToken || !occurrence) return { kind: "stale" } as const;
    if (["completed", "failed", "cancelled"].includes(input.runState)) {
      occurrence.state = input.runState === "completed" ? "succeeded" : input.runState === "failed" ? "failed" : "cancelled"; occurrence.stage = "complete"; occurrence.failureCode = input.failureCode; occurrence.completedAt = new Date(input.observedAt); intent.state = "delivered"; intent.deliveredAt = new Date(input.observedAt);
      if (!input.terminalEvent || !this.append(input.terminalEvent)) return { kind: "unavailable" } as const;
    } else { occurrence.state = input.runState === "waiting" || input.runState === "outcome_unknown" ? "waiting" : "running"; intent.state = "pending"; intent.availableAt = new Date(input.retryAt!); }
    occurrence.updatedAt = new Date(input.observedAt); intent.claimToken = null; intent.claimedAt = null;
    return { kind: "created", value: clone(occurrence) } as const;
  }

  async settleWorkflowCancellation(input: { outboxId: string; claimToken: string; workspaceId: string; occurrenceId: string; result: "accepted" | "too_late" | "unavailable"; retryAt: Date | null; occurredAt: Date }) {
    const intent = this.outbox.get(input.outboxId); const occurrence = this.occurrences.get(key(input.workspaceId, input.occurrenceId));
    if (!intent || intent.state !== "claimed" || intent.claimToken !== input.claimToken || !occurrence) return { kind: "stale" } as const;
    if (input.result === "unavailable") { intent.state = "pending"; intent.availableAt = new Date(input.retryAt!); }
    else { intent.state = "delivered"; intent.deliveredAt = new Date(input.occurredAt); }
    intent.claimToken = null; intent.claimedAt = null; return { kind: "created", value: clone(occurrence) } as const;
  }

  async preventCancelledMaterialization(input: { outboxId: string; claimToken: string; workspaceId: string; occurrenceId: string; event: AutomationEventRecord; occurredAt: Date }) {
    const intent = this.outbox.get(input.outboxId); const occurrence = this.occurrences.get(key(input.workspaceId, input.occurrenceId));
    if (!intent || intent.state !== "claimed" || intent.claimToken !== input.claimToken || !occurrence || occurrence.workflowRunId !== null || occurrence.desiredState !== "cancel") return { kind: "stale" } as const;
    occurrence.state = "cancelled"; occurrence.stage = "complete"; occurrence.completedAt = new Date(input.occurredAt); occurrence.updatedAt = new Date(input.occurredAt);
    intent.state = "delivered"; intent.claimToken = null; intent.claimedAt = null; intent.deliveredAt = new Date(input.occurredAt);
    for (const candidate of this.outbox.values()) if (candidate.occurrenceId === occurrence.id && candidate.purpose === "cancel_workflow" && (candidate.state === "pending" || candidate.state === "claimed")) { candidate.state = "cancelled"; candidate.claimToken = null; candidate.claimedAt = null; candidate.cancelledAt = new Date(input.occurredAt); }
    if (!this.append(input.event)) return { kind: "unavailable" } as const;
    return { kind: "created", value: clone(occurrence) } as const;
  }
}
