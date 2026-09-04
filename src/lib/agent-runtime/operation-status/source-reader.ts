import { and, asc, eq, gt, inArray, or } from "drizzle-orm";
import type { getDb } from "@/lib/db";
import { brandAnalysisRuns, creatorPersonaTrainingJobs, runtimeAutomationOccurrences, runtimePublishingDeliveries, workflowRuns, workspaceGovernanceResources } from "@/lib/db/schema";
import { getOperationProjectionAdapter } from "./adapters";
import type { OperationKind, OperationState } from "./types";

type Db = ReturnType<typeof getDb>;
export interface ProjectedSourceOperation { adapterId: string; checkpointId?: string; kind: OperationKind; workspaceId: string; resourceId: string; state: OperationState; stage: string | null; updatedAt: Date; metadata: Record<string, unknown>; }
const date = (value: Date | string) => value instanceof Date ? value : new Date(value);
function project(adapterId: string, source: { workspaceId: string; resourceId: string; state: string; stage?: string | null; updatedAt: Date | string }, metadata: Record<string, unknown> = {}, checkpointId = adapterId): ProjectedSourceOperation {
  const adapter = getOperationProjectionAdapter(adapterId); if (!adapter) throw new Error(`Missing operation adapter ${adapterId}`);
  const snapshot = { ...source, updatedAt: date(source.updatedAt), metadata }; const value = adapter.project(snapshot);
  return { adapterId, checkpointId, kind: adapter.kind, workspaceId: source.workspaceId, resourceId: source.resourceId, state: value.state, stage: value.stage, updatedAt: snapshot.updatedAt, metadata: value.metadata };
}

type Cursor = { updatedAt: Date; id: string };
const after = <TUpdated, TId>(updatedAt: TUpdated, id: TId, cursor: Cursor | null) => cursor ? or(gt(updatedAt as never, cursor.updatedAt), and(eq(updatedAt as never, cursor.updatedAt), gt(id as never, cursor.id))) : undefined;

export const OPERATION_PROJECTION_SOURCE_IDS = ["workflow-runs/v1", "brand-analysis-runs/v1", "governance-resources/v1", "runtime-automations/v1", "publishing-deliveries/v1", "creator-persona-training/v1"] as const;
export type OperationProjectionSourceId = typeof OPERATION_PROJECTION_SOURCE_IDS[number];

/** Reads exactly one oldest-first keyset page so bootstrap and catch-up never accumulate a source history in memory. */
export async function readSourceOperationProjectionPage(database: Db, workspaceId: string, sourceId: OperationProjectionSourceId, pageSize = 200, checkpoint?: { updatedAt: Date; resourceId: string }): Promise<ProjectedSourceOperation[]> {
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 1_000) throw new Error("OPERATION_SOURCE_PAGE_SIZE_INVALID");
  const cursor = checkpoint ? { updatedAt: checkpoint.updatedAt, id: checkpoint.resourceId } : null;
  if (sourceId === "workflow-runs/v1") {
    const rows = await database.select({ workspaceId: workflowRuns.workspaceId, resourceId: workflowRuns.id, state: workflowRuns.state, updatedAt: workflowRuns.updatedAt, workflowId: workflowRuns.workflowId, principalId: workflowRuns.principalId, authorizationEvidenceRef: workflowRuns.authorizationEvidenceRef, reasonCode: workflowRuns.failureCode }).from(workflowRuns).where(and(eq(workflowRuns.workspaceId, workspaceId), after(workflowRuns.updatedAt, workflowRuns.id, cursor))).orderBy(asc(workflowRuns.updatedAt), asc(workflowRuns.id)).limit(pageSize);
    return rows.map((row) => project(sourceId, row, { workflowId: row.workflowId, principalId: row.principalId, authorizationEvidenceRef: row.authorizationEvidenceRef, reasonCode: row.reasonCode, nextAction: row.state === "failed" ? "inspect_failure" : "inspect_run" }));
  }
  if (sourceId === "brand-analysis-runs/v1") {
    const rows = await database.select({ workspaceId: brandAnalysisRuns.workspaceId, resourceId: brandAnalysisRuns.id, state: brandAnalysisRuns.status, stage: brandAnalysisRuns.stage, updatedAt: brandAnalysisRuns.updatedAt, sourceId: brandAnalysisRuns.sourceId, reasonCode: brandAnalysisRuns.errorCode }).from(brandAnalysisRuns).where(and(eq(brandAnalysisRuns.workspaceId, workspaceId), after(brandAnalysisRuns.updatedAt, brandAnalysisRuns.id, cursor))).orderBy(asc(brandAnalysisRuns.updatedAt), asc(brandAnalysisRuns.id)).limit(pageSize);
    return rows.map((row) => project(sourceId, row, { sourceId: row.sourceId, reasonCode: row.reasonCode, nextAction: row.reasonCode ? "review_brand_source" : "inspect_brand_ingestion" }));
  }
  if (sourceId === "governance-resources/v1") {
    const rows = await database.select({ workspaceId: workspaceGovernanceResources.workspaceId, resourceId: workspaceGovernanceResources.id, kind: workspaceGovernanceResources.kind, state: workspaceGovernanceResources.status, updatedAt: workspaceGovernanceResources.updatedAt, principalId: workspaceGovernanceResources.createdByUserId, resourceVersion: workspaceGovernanceResources.version }).from(workspaceGovernanceResources).where(and(eq(workspaceGovernanceResources.workspaceId, workspaceId), inArray(workspaceGovernanceResources.kind, ["audit_export", "workspace_export", "bulk_operation", "workspace_import"]), after(workspaceGovernanceResources.updatedAt, workspaceGovernanceResources.id, cursor))).orderBy(asc(workspaceGovernanceResources.updatedAt), asc(workspaceGovernanceResources.id)).limit(pageSize);
    return rows.map((row) => project(row.kind === "bulk_operation" ? "governance-bulk/v1" : row.kind === "workspace_import" ? "workspace-imports/v1" : "governance-exports/v1", row, { principalId: row.principalId, resourceVersion: row.resourceVersion, nextAction: "inspect_governance_resource" }, sourceId));
  }
  if (sourceId === "runtime-automations/v1") {
    const rows = await database.select({ workspaceId: runtimeAutomationOccurrences.workspaceId, resourceId: runtimeAutomationOccurrences.id, state: runtimeAutomationOccurrences.state, stage: runtimeAutomationOccurrences.stage, updatedAt: runtimeAutomationOccurrences.updatedAt, automationId: runtimeAutomationOccurrences.automationId, workflowId: runtimeAutomationOccurrences.workflowId, principalId: runtimeAutomationOccurrences.requestingPrincipalId, authorizationEvidenceRef: runtimeAutomationOccurrences.invocationAuthorizationEvidenceRef, reasonCode: runtimeAutomationOccurrences.failureCode }).from(runtimeAutomationOccurrences).where(and(eq(runtimeAutomationOccurrences.workspaceId, workspaceId), after(runtimeAutomationOccurrences.updatedAt, runtimeAutomationOccurrences.id, cursor))).orderBy(asc(runtimeAutomationOccurrences.updatedAt), asc(runtimeAutomationOccurrences.id)).limit(pageSize);
    return rows.map((row) => project(sourceId, row, { automationId: row.automationId, workflowId: row.workflowId, principalId: row.principalId, authorizationEvidenceRef: row.authorizationEvidenceRef, reasonCode: row.reasonCode, nextAction: row.reasonCode ? "inspect_failure" : "inspect_automation" }));
  }
  if (sourceId === "creator-persona-training/v1") {
    const rows = await database.select({ workspaceId: creatorPersonaTrainingJobs.workspaceId, resourceId: creatorPersonaTrainingJobs.id, state: creatorPersonaTrainingJobs.state, updatedAt: creatorPersonaTrainingJobs.updatedAt, provider: creatorPersonaTrainingJobs.provider, model: creatorPersonaTrainingJobs.model, version: creatorPersonaTrainingJobs.modelVersion, reasonCode: creatorPersonaTrainingJobs.failureCode }).from(creatorPersonaTrainingJobs).where(and(eq(creatorPersonaTrainingJobs.workspaceId, workspaceId), after(creatorPersonaTrainingJobs.updatedAt, creatorPersonaTrainingJobs.id, cursor))).orderBy(asc(creatorPersonaTrainingJobs.updatedAt), asc(creatorPersonaTrainingJobs.id)).limit(pageSize);
    return rows.map((row) => project(sourceId, row, { provider: row.provider, model: row.model, version: row.version, reasonCode: row.reasonCode, nextAction: row.reasonCode ? "review_persona_training" : "inspect_persona" }));
  }
  const rows = await database.select({ workspaceId: runtimePublishingDeliveries.workspaceId, resourceId: runtimePublishingDeliveries.id, state: runtimePublishingDeliveries.state, updatedAt: runtimePublishingDeliveries.updatedAt, principalId: runtimePublishingDeliveries.requestingPrincipalId, channelId: runtimePublishingDeliveries.channelId, providerOperationRef: runtimePublishingDeliveries.providerOperationRef, reasonCode: runtimePublishingDeliveries.failureCode, retryable: runtimePublishingDeliveries.failureRetryable }).from(runtimePublishingDeliveries).where(and(eq(runtimePublishingDeliveries.workspaceId, workspaceId), after(runtimePublishingDeliveries.updatedAt, runtimePublishingDeliveries.id, cursor))).orderBy(asc(runtimePublishingDeliveries.updatedAt), asc(runtimePublishingDeliveries.id)).limit(pageSize);
  return rows.map((row) => project(sourceId, row, { principalId: row.principalId, channelId: row.channelId, providerOperationRef: row.providerOperationRef, reasonCode: row.reasonCode, retryable: row.retryable, nextAction: row.reasonCode ? row.retryable ? "retry_delivery" : "inspect_failure" : "inspect_delivery" }));
}
