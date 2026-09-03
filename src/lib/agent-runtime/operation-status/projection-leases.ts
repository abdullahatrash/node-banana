import { and, asc, eq, lte } from "drizzle-orm";
import type { getDb } from "@/lib/db";
import { workspaces } from "@/lib/db/schema";
import { runtimeOperationProjectionLeases } from "./db-schema";

type Db = ReturnType<typeof getDb>;

export async function claimOperationProjectionWorkspaces(database: Db, input: { owner: string; at: Date; limit: number; leaseMs: number }) {
  return database.transaction(async (tx) => {
    const workspaceRows = await tx.select({ workspaceId: workspaces.id }).from(workspaces).limit(5_000);
    if (workspaceRows.length) await tx.insert(runtimeOperationProjectionLeases).values(workspaceRows.map(({ workspaceId }) => ({ workspaceId, leaseOwner: null, leaseExpiresAt: new Date(0), lastProjectedAt: null, updatedAt: input.at }))).onConflictDoNothing();
    const due = await tx.select({ workspaceId: runtimeOperationProjectionLeases.workspaceId }).from(runtimeOperationProjectionLeases).where(lte(runtimeOperationProjectionLeases.leaseExpiresAt, input.at)).orderBy(asc(runtimeOperationProjectionLeases.leaseExpiresAt), asc(runtimeOperationProjectionLeases.workspaceId)).limit(input.limit).for("update", { skipLocked: true });
    const expiresAt = new Date(input.at.getTime() + input.leaseMs);
    for (const row of due) await tx.update(runtimeOperationProjectionLeases).set({ leaseOwner: input.owner, leaseExpiresAt: expiresAt, updatedAt: input.at }).where(eq(runtimeOperationProjectionLeases.workspaceId, row.workspaceId));
    return due.map((row) => row.workspaceId);
  });
}

export async function completeOperationProjectionLease(database: Db, input: { workspaceId: string; owner: string; at: Date }) {
  await database.update(runtimeOperationProjectionLeases).set({ leaseOwner: null, leaseExpiresAt: input.at, lastProjectedAt: input.at, updatedAt: input.at }).where(and(eq(runtimeOperationProjectionLeases.workspaceId, input.workspaceId), eq(runtimeOperationProjectionLeases.leaseOwner, input.owner)));
}
