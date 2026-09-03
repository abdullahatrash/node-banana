export const OPERATION_STATES = [
  "queued", "admitted", "running", "waiting_user", "waiting_provider",
  "waiting_quota", "waiting_time", "blocked", "cancelling", "cancelled",
  "succeeded", "failed_known", "outcome_unknown",
] as const;

export type OperationState = (typeof OPERATION_STATES)[number];
export type OperationKind =
  | "workflow_run" | "brand_ingestion" | "governance_export"
  | "governance_bulk" | "workspace_import" | "automation"
  | "publishing_delivery" | "generation";

export type OperationActor =
  | { type: "human"; userId: string }
  | { type: "agent"; principalId: string; keyId: string }
  | { type: "system"; service: string };

export interface OperationRecord {
  schema: "operation-status/v1";
  id: string;
  workspaceId: string;
  kind: OperationKind;
  resourceId: string;
  state: OperationState;
  stage: string | null;
  revision: number;
  actor: OperationActor;
  metadata: Record<string, string | number | boolean | null>;
  retryOfOperationId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface OperationEvent {
  schema: "operation-event/v1";
  id: string;
  workspaceId: string;
  operationId: string;
  revision: number;
  from: OperationState | null;
  to: OperationState;
  stage: string | null;
  reasonCode: string;
  actor: OperationActor;
  occurredAt: Date;
}

export interface OperationFilter {
  states?: OperationState[];
  kinds?: OperationKind[];
  limit: number;
}

export type OperationMutationResult =
  | { kind: "applied" | "replayed"; operation: OperationRecord }
  | { kind: "conflict" | "not_found" | "unavailable" };
