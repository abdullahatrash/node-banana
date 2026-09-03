import { and, desc, eq, inArray, lt, or } from "drizzle-orm";
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

type Cursor = { updatedAt: Date; id: string };
async function readAll<T extends { resourceId: string; updatedAt: Date | string }>(pageSize: number, page: (cursor: Cursor | null) => Promise<T[]>): Promise<T[]> {
  const values: T[] = []; let cursor: Cursor | null = null;
  for (;;) {
    const rows = await page(cursor); values.push(...rows);
    if (rows.length < pageSize) return values;
    const last = rows.at(-1)!; cursor = { updatedAt: date(last.updatedAt), id: last.resourceId };
  }
}
const before = <TUpdated, TId>(updatedAt: TUpdated, id: TId, cursor: Cursor | null) => cursor ? or(lt(updatedAt as never, cursor.updatedAt), and(eq(updatedAt as never, cursor.updatedAt), lt(id as never, cursor.id))) : undefined;

export async function readSourceOperationProjections(database: Db, workspaceId: string, pageSize = 200): Promise<ProjectedSourceOperation[]> {
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 1_000) throw new Error("OPERATION_SOURCE_PAGE_SIZE_INVALID");
  const [runs, brands, governance, automations, deliveries] = await Promise.all([
    readAll(pageSize, (cursor) => database.select({ workspaceId: workflowRuns.workspaceId, resourceId: workflowRuns.id, state: workflowRuns.state, updatedAt: workflowRuns.updatedAt }).from(workflowRuns).where(and(eq(workflowRuns.workspaceId, workspaceId), before(workflowRuns.updatedAt, workflowRuns.id, cursor))).orderBy(desc(workflowRuns.updatedAt), desc(workflowRuns.id)).limit(pageSize)),
    readAll(pageSize, (cursor) => database.select({ workspaceId: brandAnalysisRuns.workspaceId, resourceId: brandAnalysisRuns.id, state: brandAnalysisRuns.status, stage: brandAnalysisRuns.stage, updatedAt: brandAnalysisRuns.updatedAt }).from(brandAnalysisRuns).where(and(eq(brandAnalysisRuns.workspaceId, workspaceId), before(brandAnalysisRuns.updatedAt, brandAnalysisRuns.id, cursor))).orderBy(desc(brandAnalysisRuns.updatedAt), desc(brandAnalysisRuns.id)).limit(pageSize)),
    readAll(pageSize, (cursor) => database.select({ workspaceId: workspaceGovernanceResources.workspaceId, resourceId: workspaceGovernanceResources.id, kind: workspaceGovernanceResources.kind, state: workspaceGovernanceResources.status, updatedAt: workspaceGovernanceResources.updatedAt }).from(workspaceGovernanceResources).where(and(eq(workspaceGovernanceResources.workspaceId, workspaceId), inArray(workspaceGovernanceResources.kind, ["audit_export", "workspace_export", "bulk_operation", "workspace_import"]), before(workspaceGovernanceResources.updatedAt, workspaceGovernanceResources.id, cursor))).orderBy(desc(workspaceGovernanceResources.updatedAt), desc(workspaceGovernanceResources.id)).limit(pageSize)),
    readAll(pageSize, (cursor) => database.select({ workspaceId: runtimeAutomationOccurrences.workspaceId, resourceId: runtimeAutomationOccurrences.id, state: runtimeAutomationOccurrences.state, stage: runtimeAutomationOccurrences.stage, updatedAt: runtimeAutomationOccurrences.updatedAt }).from(runtimeAutomationOccurrences).where(and(eq(runtimeAutomationOccurrences.workspaceId, workspaceId), before(runtimeAutomationOccurrences.updatedAt, runtimeAutomationOccurrences.id, cursor))).orderBy(desc(runtimeAutomationOccurrences.updatedAt), desc(runtimeAutomationOccurrences.id)).limit(pageSize)),
    readAll(pageSize, (cursor) => database.select({ workspaceId: runtimePublishingDeliveries.workspaceId, resourceId: runtimePublishingDeliveries.id, state: runtimePublishingDeliveries.state, updatedAt: runtimePublishingDeliveries.updatedAt }).from(runtimePublishingDeliveries).where(and(eq(runtimePublishingDeliveries.workspaceId, workspaceId), before(runtimePublishingDeliveries.updatedAt, runtimePublishingDeliveries.id, cursor))).orderBy(desc(runtimePublishingDeliveries.updatedAt), desc(runtimePublishingDeliveries.id)).limit(pageSize)),
  ]);
  return [
    ...runs.map((row) => project("workflow-runs/v1", row)),
    ...brands.map((row) => project("brand-analysis-runs/v1", row)),
    ...governance.map((row) => project(row.kind === "bulk_operation" ? "governance-bulk/v1" : row.kind === "workspace_import" ? "workspace-imports/v1" : "governance-exports/v1", row)),
    ...automations.map((row) => project("runtime-automations/v1", row)),
    ...deliveries.map((row) => project("publishing-deliveries/v1", row)),
  ].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime() || b.resourceId.localeCompare(a.resourceId));
}
