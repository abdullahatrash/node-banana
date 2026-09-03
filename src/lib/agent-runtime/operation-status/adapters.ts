import type { OperationKind, OperationState } from "./types";

export interface SourceOperationSnapshot {
  workspaceId: string;
  resourceId: string;
  state: string;
  stage?: string | null;
  updatedAt: Date;
  metadata?: Record<string, unknown>;
}

export interface OperationProjectionAdapter {
  readonly id: string;
  readonly kind: OperationKind;
  project(source: SourceOperationSnapshot): { state: OperationState; stage: string | null; metadata: Record<string, unknown> };
}

function mapState(state: string): OperationState {
  const exact: Record<string, OperationState> = {
    queued: "queued", pending: "queued", accepted: "admitted", admitted: "admitted", running: "running", processing: "running", dispatching: "running",
    waiting_user: "waiting_user", waiting_provider: "waiting_provider", waiting_quota: "waiting_quota", waiting_time: "waiting_time",
    waiting: "waiting_time", scheduled: "waiting_time", confirmation_pending: "waiting_provider",
    blocked: "blocked", cancelling: "cancelling", cancelled: "cancelled", aborted: "cancelled", skipped: "cancelled",
    succeeded: "succeeded", completed: "succeeded", ready: "succeeded", published: "succeeded", failed: "failed_known", failed_retryable: "failed_known", failed_terminal: "failed_known", failed_transient: "failed_known", failed_known: "failed_known", outcome_unknown: "outcome_unknown",
  };
  return exact[state] ?? "blocked";
}

function adapter(id: string, kind: OperationKind): OperationProjectionAdapter {
  return { id, kind, project(source) { const state = mapState(source.state); return { state, stage: state === "running" ? source.stage ?? "execute" : null, metadata: source.metadata ?? {} }; } };
}

export const OPERATION_PROJECTION_ADAPTERS = [
  adapter("workflow-runs/v1", "workflow_run"),
  adapter("brand-analysis-runs/v1", "brand_ingestion"),
  adapter("governance-exports/v1", "governance_export"),
  adapter("governance-bulk/v1", "governance_bulk"),
  adapter("workspace-imports/v1", "workspace_import"),
  adapter("runtime-automations/v1", "automation"),
  adapter("publishing-deliveries/v1", "publishing_delivery"),
] as const;

export function getOperationProjectionAdapter(id: string): OperationProjectionAdapter | null {
  return OPERATION_PROJECTION_ADAPTERS.find((item) => item.id === id) ?? null;
}
