import type { OperationStatusRepository } from "./repository";
import type { OperationEvent, OperationFilter, OperationMutationResult, OperationRecord } from "./types";

const clone = <T>(value: T): T => structuredClone(value);

export class MemoryOperationStatusRepository implements OperationStatusRepository {
  private operations = new Map<string, OperationRecord>();
  private events = new Map<string, OperationEvent[]>();
  private receipts = new Map<string, { digest: string; operationId: string }>();
  private key(workspaceId: string, id: string) { return `${workspaceId}:${id}`; }

  async replay(workspaceId: string, idempotencyKey: string, requestDigest: string): Promise<OperationMutationResult | null> {
    const receipt = this.receipts.get(this.key(workspaceId, idempotencyKey));
    if (!receipt) return null;
    if (receipt.digest !== requestDigest) return { kind: "conflict" };
    const value = this.operations.get(this.key(workspaceId, receipt.operationId));
    return value ? { kind: "replayed", operation: clone(value) } : { kind: "unavailable" };
  }

  async create(input: { operation: OperationRecord; event: OperationEvent; idempotencyKey: string; requestDigest: string }): Promise<OperationMutationResult> {
    return this.write({ ...input, expectedRevision: 0 });
  }
  async transition(input: { operation: OperationRecord; event: OperationEvent; expectedRevision: number; idempotencyKey: string; requestDigest: string }): Promise<OperationMutationResult> {
    return this.write(input);
  }
  private async write(input: { operation: OperationRecord; event: OperationEvent; expectedRevision: number; idempotencyKey: string; requestDigest: string }): Promise<OperationMutationResult> {
    const receiptKey = this.key(input.operation.workspaceId, input.idempotencyKey);
    const receipt = this.receipts.get(receiptKey);
    if (receipt) {
      if (receipt.digest !== input.requestDigest) return { kind: "conflict" };
      const replay = this.operations.get(this.key(input.operation.workspaceId, receipt.operationId));
      return replay ? { kind: "replayed", operation: clone(replay) } : { kind: "unavailable" };
    }
    const operationKey = this.key(input.operation.workspaceId, input.operation.id);
    const current = this.operations.get(operationKey);
    if ((current?.revision ?? 0) !== input.expectedRevision) return current ? { kind: "conflict" } : input.expectedRevision ? { kind: "not_found" } : { kind: "conflict" };
    this.operations.set(operationKey, clone(input.operation));
    this.events.set(operationKey, [...(this.events.get(operationKey) ?? []), clone(input.event)]);
    this.receipts.set(receiptKey, { digest: input.requestDigest, operationId: input.operation.id });
    return { kind: "applied", operation: clone(input.operation) };
  }
  async get(workspaceId: string, operationId: string) { return clone(this.operations.get(this.key(workspaceId, operationId)) ?? null); }
  async list(workspaceId: string, filter: OperationFilter) {
    return [...this.operations.values()].filter((item) => item.workspaceId === workspaceId && (!filter.states?.length || filter.states.includes(item.state)) && (!filter.kinds?.length || filter.kinds.includes(item.kind))).sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime() || a.id.localeCompare(b.id)).slice(0, filter.limit).map(clone);
  }
  async listEvents(workspaceId: string, operationId: string, limit: number) { return clone((this.events.get(this.key(workspaceId, operationId)) ?? []).slice(-limit)); }
}
