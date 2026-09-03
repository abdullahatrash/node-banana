import { and, desc, eq, inArray } from "drizzle-orm";
import type { getDb } from "@/lib/db";
import { brandAnalysisRuns, runtimeAutomationOccurrences, runtimePublishingDeliveries, workflowRuns, workspaceGovernanceResources } from "@/lib/db/schema";
import { getOperationProjectionAdapter } from "./adapters";
import type { OperationKind, OperationState } from "./types";

type Db = ReturnType<typeof getDb>;
export interface ProjectedSourceOperation { adapterId: string; kind: OperationKind; workspaceId: string; resourceId: string; state: OperationState; stage: string | null; updatedAt: Date; metadata: Record<string, unknown>; }
const date = (value: Date | string) => value instanceof Date ? value : new Date(value);
function project(adapterId: string, source: { workspaceId: string; resourceId: string; state: string; stage?: string | null; updatedAt: Date | string }, metadata: Record<string, unknown> = {}): ProjectedSourceOperation {
  const adapter = getOperationProjectionAdapter(adapterId); if (!adapter) throw new Error(`Missing operation adapter ${adapterId}`);
  const snapshot = { ...source, updatedAt: date(source.updatedAt), metadata }; const value = adapter.project(snapshot);
  return { adapterId, kind: adapter.kind, workspaceId: source.workspaceId, resourceId: source.resourceId, state: value.state, stage: value.stage, updatedAt: snapshot.updatedAt, metadata: value.metadata };
}

export async function readSourceOperationProjections(database: Db, workspaceId: string, limit = 200): Promise<ProjectedSourceOperation[]> {
  const [runs, brands, governance, automations, deliveries] = await Promise.all([
    database.select({ workspaceId: workflowRuns.workspaceId, resourceId: workflowRuns.id, state: workflowRuns.state, updatedAt: workflowRuns.updatedAt }).from(workflowRuns).where(eq(workflowRuns.workspaceId, workspaceId)).orderBy(desc(workflowRuns.updatedAt)).limit(limit),
    database.select({ workspaceId: brandAnalysisRuns.workspaceId, resourceId: brandAnalysisRuns.id, state: brandAnalysisRuns.status, stage: brandAnalysisRuns.stage, updatedAt: brandAnalysisRuns.updatedAt }).from(brandAnalysisRuns).where(eq(brandAnalysisRuns.workspaceId, workspaceId)).orderBy(desc(brandAnalysisRuns.updatedAt)).limit(limit),
    database.select({ workspaceId: workspaceGovernanceResources.workspaceId, resourceId: workspaceGovernanceResources.id, kind: workspaceGovernanceResources.kind, state: workspaceGovernanceResources.status, updatedAt: workspaceGovernanceResources.updatedAt }).from(workspaceGovernanceResources).where(and(eq(workspaceGovernanceResources.workspaceId, workspaceId), inArray(workspaceGovernanceResources.kind, ["audit_export", "workspace_export", "bulk_operation", "workspace_import"]))).orderBy(desc(workspaceGovernanceResources.updatedAt)).limit(limit),
    database.select({ workspaceId: runtimeAutomationOccurrences.workspaceId, resourceId: runtimeAutomationOccurrences.id, state: runtimeAutomationOccurrences.state, stage: runtimeAutomationOccurrences.stage, updatedAt: runtimeAutomationOccurrences.updatedAt }).from(runtimeAutomationOccurrences).where(eq(runtimeAutomationOccurrences.workspaceId, workspaceId)).orderBy(desc(runtimeAutomationOccurrences.updatedAt)).limit(limit),
    database.select({ workspaceId: runtimePublishingDeliveries.workspaceId, resourceId: runtimePublishingDeliveries.id, state: runtimePublishingDeliveries.state, updatedAt: runtimePublishingDeliveries.updatedAt }).from(runtimePublishingDeliveries).where(eq(runtimePublishingDeliveries.workspaceId, workspaceId)).orderBy(desc(runtimePublishingDeliveries.updatedAt)).limit(limit),
  ]);
  return [
    ...runs.map((row) => project("workflow-runs/v1", row)),
    ...brands.map((row) => project("brand-analysis-runs/v1", row)),
    ...governance.map((row) => project(row.kind === "bulk_operation" ? "governance-bulk/v1" : row.kind === "workspace_import" ? "workspace-imports/v1" : "governance-exports/v1", row)),
    ...automations.map((row) => project("runtime-automations/v1", row)),
    ...deliveries.map((row) => project("publishing-deliveries/v1", row)),
  ].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime()).slice(0, limit);
}
