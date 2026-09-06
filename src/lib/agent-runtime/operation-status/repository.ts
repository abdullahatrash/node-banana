import type { OperationEvent, OperationFilter, OperationMutationResult, OperationRecord } from "./types";

export interface OperationStatusRepository {
  replay(workspaceId: string, idempotencyKey: string, requestDigest: string): Promise<OperationMutationResult | null>;
  create(input: { operation: OperationRecord; event: OperationEvent; idempotencyKey: string; requestDigest: string }): Promise<OperationMutationResult>;
  transition(input: { operation: OperationRecord; event: OperationEvent; expectedRevision: number; idempotencyKey: string; requestDigest: string }): Promise<OperationMutationResult>;
  get(workspaceId: string, operationId: string): Promise<OperationRecord | null>;
  list(workspaceId: string, filter: OperationFilter): Promise<OperationRecord[]>;
  listEvents(workspaceId: string, operationId: string, limit: number): Promise<OperationEvent[]>;
}
