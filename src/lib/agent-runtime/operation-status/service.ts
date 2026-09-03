import { createHash, randomUUID } from "node:crypto";
import { canRetryOperation, canTransitionOperation } from "./state-machine";
import { redactOperationMetadata } from "./redaction";
import type { OperationStatusRepository } from "./repository";
import type { OperationActor, OperationFilter, OperationKind, OperationMutationResult, OperationRecord, OperationState } from "./types";
import { OperationControlRegistry } from "./controls";

const digest = (value: unknown) => `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
const id = () => randomUUID();

export class OperationStatusService {
  constructor(private readonly repository: OperationStatusRepository, private readonly now = () => new Date(), private readonly controls = new OperationControlRegistry()) {}

  async create(input: { workspaceId: string; kind: OperationKind; resourceId: string; actor: OperationActor; metadata?: Record<string, unknown>; idempotencyKey: string; operationId?: string; retryOfOperationId?: string | null }): Promise<OperationMutationResult> {
    const requestDigest = digest({ command: "create", workspaceId: input.workspaceId, kind: input.kind, resourceId: input.resourceId, actor: input.actor, metadata: redactOperationMetadata(input.metadata ?? {}), retryOfOperationId: input.retryOfOperationId ?? null, operationId: input.operationId ?? null });
    const replay = await this.repository.replay(input.workspaceId, input.idempotencyKey, requestDigest);
    if (replay) return replay;
    const at = this.now();
    const operation: OperationRecord = { schema: "operation-status/v1", id: input.operationId ?? id(), workspaceId: input.workspaceId, kind: input.kind, resourceId: input.resourceId, state: "queued", stage: null, revision: 1, actor: input.actor, metadata: redactOperationMetadata(input.metadata ?? {}), retryOfOperationId: input.retryOfOperationId ?? null, createdAt: at, updatedAt: at };
    return this.repository.create({ operation, idempotencyKey: input.idempotencyKey, requestDigest, event: { schema: "operation-event/v1", id: id(), workspaceId: input.workspaceId, operationId: operation.id, revision: 1, from: null, to: "queued", stage: null, reasonCode: "operation.created", actor: input.actor, occurredAt: at } });
  }

  async transition(input: { workspaceId: string; operationId: string; expectedRevision: number; to: OperationState; stage?: string | null; reasonCode: string; actor: OperationActor; metadata?: Record<string, unknown>; idempotencyKey: string; idempotencyDigest?: string }): Promise<OperationMutationResult> {
    const requestDigest = input.idempotencyDigest ?? digest({ command: "transition", ...input, idempotencyDigest: undefined, metadata: redactOperationMetadata(input.metadata ?? {}) });
    const replay = await this.repository.replay(input.workspaceId, input.idempotencyKey, requestDigest);
    if (replay) return replay;
    const current = await this.repository.get(input.workspaceId, input.operationId);
    if (!current) return { kind: "not_found" };
    const stage = input.to === "running" ? input.stage ?? null : null;
    if (current.revision !== input.expectedRevision || !canTransitionOperation(current.state, input.to, stage) || !/^[a-z][a-z0-9_.-]{2,99}$/.test(input.reasonCode)) return { kind: "conflict" };
    const at = this.now();
    const operation: OperationRecord = { ...current, state: input.to, stage, revision: current.revision + 1, actor: input.actor, metadata: { ...current.metadata, ...redactOperationMetadata(input.metadata ?? {}) }, updatedAt: at };
    return this.repository.transition({ operation, expectedRevision: current.revision, idempotencyKey: input.idempotencyKey, requestDigest, event: { schema: "operation-event/v1", id: id(), workspaceId: input.workspaceId, operationId: current.id, revision: operation.revision, from: current.state, to: operation.state, stage, reasonCode: input.reasonCode, actor: input.actor, occurredAt: at } });
  }

  async requestCancellation(input: { workspaceId: string; operationId: string; expectedRevision: number; actor: OperationActor; idempotencyKey: string }) {
    const idempotencyDigest = digest({ command: "cancel", ...input });
    const replay = await this.repository.replay(input.workspaceId, input.idempotencyKey, idempotencyDigest);
    if (replay) return replay;
    const current = await this.repository.get(input.workspaceId, input.operationId);
    if (!current) return { kind: "not_found" as const };
    const immediate = current.state === "queued" || current.state === "waiting_user" || current.state === "waiting_quota" || current.state === "waiting_time" || current.state === "blocked" || current.state === "admitted";
    if (immediate) return this.transition({ ...input, to: "cancelled", reasonCode: "operation.cancelled_before_effect", idempotencyDigest });
    const adapter = this.controls.adapter(current.kind);
    if (!adapter) return { kind: "unavailable" as const };
    const dispatched = await adapter.cancel(current);
    if (dispatched.kind === "conflict" || dispatched.kind === "unavailable") return { kind: dispatched.kind };
    if (dispatched.kind === "outcome_unknown") return this.transition({ ...input, to: "outcome_unknown", reasonCode: "operation.cancel_outcome_unknown", idempotencyDigest });
    const cancelling = await this.transition({ ...input, idempotencyKey: `${input.idempotencyKey}:dispatch`, to: "cancelling", reasonCode: "operation.cancellation_dispatched" });
    if (dispatched.kind === "accepted" || (cancelling.kind !== "applied" && cancelling.kind !== "replayed")) return cancelling;
    return this.transition({ ...input, expectedRevision: cancelling.operation.revision, to: "cancelled", reasonCode: "operation.cancellation_confirmed", idempotencyDigest });
  }

  async retry(input: { workspaceId: string; operationId: string; actor: OperationActor; idempotencyKey: string }): Promise<OperationMutationResult> {
    const current = await this.repository.get(input.workspaceId, input.operationId);
    if (!current) return { kind: "not_found" };
    if (!canRetryOperation(current.state)) return { kind: "conflict" };
    const adapter = this.controls.adapter(current.kind);
    if (!adapter) return { kind: "unavailable" };
    const dispatched = await adapter.retry(current);
    if (dispatched.kind !== "accepted") return { kind: dispatched.kind };
    return this.create({ workspaceId: current.workspaceId, kind: current.kind, resourceId: dispatched.resourceId, actor: input.actor, metadata: { ...current.metadata, ...(dispatched.metadata ?? {}) }, idempotencyKey: input.idempotencyKey, retryOfOperationId: current.id });
  }

  get(workspaceId: string, operationId: string) { return this.repository.get(workspaceId, operationId); }
  list(workspaceId: string, filter: OperationFilter) { return this.repository.list(workspaceId, filter); }
  listEvents(workspaceId: string, operationId: string, limit = 100) { return this.repository.listEvents(workspaceId, operationId, limit); }
}
