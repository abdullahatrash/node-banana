import type { OperationState } from "./types";

const TERMINAL = new Set<OperationState>(["cancelled", "succeeded", "failed_known"]);
const transitions: Record<OperationState, ReadonlySet<OperationState>> = {
  queued: new Set(["admitted", "cancelling", "cancelled", "failed_known"]),
  admitted: new Set(["running", "waiting_user", "waiting_provider", "waiting_quota", "waiting_time", "blocked", "cancelling", "cancelled", "failed_known"]),
  running: new Set(["running", "waiting_user", "waiting_provider", "waiting_quota", "waiting_time", "blocked", "cancelling", "succeeded", "failed_known", "outcome_unknown"]),
  waiting_user: new Set(["admitted", "running", "cancelling", "cancelled", "failed_known"]),
  waiting_provider: new Set(["running", "waiting_time", "cancelling", "cancelled", "succeeded", "failed_known", "outcome_unknown"]),
  waiting_quota: new Set(["admitted", "waiting_time", "cancelling", "cancelled", "failed_known"]),
  waiting_time: new Set(["admitted", "running", "cancelling", "cancelled", "failed_known"]),
  blocked: new Set(["admitted", "cancelling", "cancelled", "failed_known"]),
  cancelling: new Set(["cancelled", "succeeded", "failed_known", "outcome_unknown"]),
  cancelled: new Set(), succeeded: new Set(), failed_known: new Set(),
  outcome_unknown: new Set(["cancelled", "succeeded", "failed_known"]),
};

export function isTerminalOperationState(state: OperationState): boolean {
  return TERMINAL.has(state);
}

export function canTransitionOperation(from: OperationState, to: OperationState, stage: string | null): boolean {
  if (!transitions[from].has(to)) return false;
  if (to === "running" && (!stage || !/^[a-z][a-z0-9_.-]{0,79}$/.test(stage))) return false;
  return true;
}

export function canRetryOperation(state: OperationState): boolean {
  return state === "failed_known" || state === "cancelled";
}
