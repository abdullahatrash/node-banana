import type { OperationKind, OperationRecord } from "./types";

export type OperationCancelDispatch =
  | { kind: "accepted" }
  | { kind: "confirmed_cancelled" }
  | { kind: "outcome_unknown" }
  | { kind: "conflict" | "unavailable" };
export type OperationRetryDispatch =
  | { kind: "accepted"; resourceId: string; metadata?: Record<string, unknown> }
  | { kind: "conflict" | "unavailable" };

export interface OperationControlAdapter {
  cancel(operation: OperationRecord): Promise<OperationCancelDispatch>;
  retry(operation: OperationRecord): Promise<OperationRetryDispatch>;
}

export class OperationControlRegistry {
  private readonly adapters = new Map<OperationKind, OperationControlAdapter>();
  register(kind: OperationKind, adapter: OperationControlAdapter) { this.adapters.set(kind, adapter); return this; }
  adapter(kind: OperationKind) { return this.adapters.get(kind) ?? null; }
}
