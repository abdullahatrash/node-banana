import type { OperationKind, OperationRecord } from "./types";
import { isTerminalOperationState } from "./state-machine";

export type OperationCancelDispatch =
  | { kind: "accepted" }
  | { kind: "confirmed_cancelled" }
  | { kind: "outcome_unknown" }
  | { kind: "conflict" | "unavailable" };
export type OperationRetryDispatch =
  | { kind: "accepted"; resourceId: string; metadata?: Record<string, unknown> }
  | { kind: "conflict" | "unavailable" };

export interface OperationControlAdapter {
  readonly supportsCancel?: boolean;
  readonly supportsRetry?: boolean;
  cancel(operation: OperationRecord): Promise<OperationCancelDispatch>;
  retry(operation: OperationRecord): Promise<OperationRetryDispatch>;
}

export class OperationControlRegistry {
  private readonly adapters = new Map<OperationKind, OperationControlAdapter>();
  register(kind: OperationKind, adapter: OperationControlAdapter) { this.adapters.set(kind, adapter); return this; }
  adapter(kind: OperationKind) { return this.adapters.get(kind) ?? null; }
  availability(operation: OperationRecord) {
    const adapter = this.adapter(operation.kind);
    return {
      cancel: !isTerminalOperationState(operation.state) && operation.state !== "outcome_unknown" && Boolean(adapter?.supportsCancel),
      retry: ["failed_known", "cancelled"].includes(operation.state) && Boolean(adapter?.supportsRetry),
    };
  }
}
