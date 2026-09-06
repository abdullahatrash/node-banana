import { and, eq } from "drizzle-orm";
import type { getDb } from "@/lib/db";
import { runtimeOperationProjectionCheckpoints, runtimeOperationProjectionLeases } from "./db-schema";
import type { ProjectedSourceOperation } from "./source-reader";

type Db = ReturnType<typeof getDb>;
export type ProjectionCheckpoint = { updatedAt: Date; resourceId: string };
export type ProjectionCheckpoints = Record<string, ProjectionCheckpoint>;

export async function loadOperationProjectionCheckpoints(database: Db, workspaceId: string): Promise<ProjectionCheckpoints> {
  const rows = await database.select().from(runtimeOperationProjectionCheckpoints).where(eq(runtimeOperationProjectionCheckpoints.workspaceId, workspaceId));
  return Object.fromEntries(rows.map((row) => [row.sourceAdapter, { updatedAt: row.lastSourceUpdatedAt, resourceId: row.lastResourceId }]));
}

export function advanceOperationProjectionCheckpoints(current: ProjectionCheckpoints, sources: ProjectedSourceOperation[]): ProjectionCheckpoints {
  const next = { ...current };
  for (const source of sources) {
    const checkpointId = source.checkpointId ?? source.adapterId;
    const prior = next[checkpointId];
    if (!prior || source.updatedAt > prior.updatedAt || (source.updatedAt.getTime() === prior.updatedAt.getTime() && source.resourceId > prior.resourceId)) next[checkpointId] = { updatedAt: source.updatedAt, resourceId: source.resourceId };
  }
  return next;
}

/** Persists source watermarks only while this worker still owns the Workspace lease. */
export async function saveOperationProjectionCheckpoints(database: Db, input: { workspaceId: string; owner: string; checkpoints: ProjectionCheckpoints; at: Date }) {
  return database.transaction(async (tx) => {
    const [lease] = await tx.select({ owner: runtimeOperationProjectionLeases.leaseOwner, expiresAt: runtimeOperationProjectionLeases.leaseExpiresAt }).from(runtimeOperationProjectionLeases).where(and(eq(runtimeOperationProjectionLeases.workspaceId, input.workspaceId), eq(runtimeOperationProjectionLeases.leaseOwner, input.owner))).limit(1).for("update");
    if (!lease || lease.expiresAt <= input.at) throw new Error("OPERATION_PROJECTION_LEASE_LOST");
    for (const [sourceAdapter, checkpoint] of Object.entries(input.checkpoints)) {
      await tx.insert(runtimeOperationProjectionCheckpoints).values({ workspaceId: input.workspaceId, sourceAdapter, lastSourceUpdatedAt: checkpoint.updatedAt, lastResourceId: checkpoint.resourceId, updatedAt: input.at }).onConflictDoUpdate({ target: [runtimeOperationProjectionCheckpoints.workspaceId, runtimeOperationProjectionCheckpoints.sourceAdapter], set: { lastSourceUpdatedAt: checkpoint.updatedAt, lastResourceId: checkpoint.resourceId, updatedAt: input.at } });
    }
  });
}
