import { and, asc, eq, gt, lte, sql } from "drizzle-orm";
import type { getDb } from "@/lib/db";
import { runtimeOperationProjectionLeases } from "./db-schema";

type Db = ReturnType<typeof getDb>;

export async function claimOperationProjectionWorkspaces(database: Db, input: { owner: string; at: Date; limit: number; leaseMs: number }) {
  return database.transaction(async (tx) => {
    await tx.execute(sql`insert into runtime_operation_projection_leases (workspace_id, lease_owner, lease_expires_at, last_projected_at, updated_at) select id, null, to_timestamp(0), null, ${input.at} from workspaces on conflict (workspace_id) do nothing`);
    const due = await tx.select({ workspaceId: runtimeOperationProjectionLeases.workspaceId }).from(runtimeOperationProjectionLeases).where(lte(runtimeOperationProjectionLeases.leaseExpiresAt, input.at)).orderBy(asc(runtimeOperationProjectionLeases.leaseExpiresAt), asc(runtimeOperationProjectionLeases.workspaceId)).limit(input.limit).for("update", { skipLocked: true });
    const expiresAt = new Date(input.at.getTime() + input.leaseMs);
    for (const row of due) await tx.update(runtimeOperationProjectionLeases).set({ leaseOwner: input.owner, leaseExpiresAt: expiresAt, updatedAt: input.at }).where(eq(runtimeOperationProjectionLeases.workspaceId, row.workspaceId));
    return due.map((row) => row.workspaceId);
  });
}

export async function completeOperationProjectionLease(database: Db, input: { workspaceId: string; owner: string; at: Date }) {
  await database.update(runtimeOperationProjectionLeases).set({ leaseOwner: null, leaseExpiresAt: input.at, lastProjectedAt: input.at, updatedAt: input.at }).where(and(eq(runtimeOperationProjectionLeases.workspaceId, input.workspaceId), eq(runtimeOperationProjectionLeases.leaseOwner, input.owner)));
}

export async function renewOperationProjectionLease(database: Db, input: { workspaceId: string; owner: string; at: Date; leaseMs: number }) {
  const rows = await database.update(runtimeOperationProjectionLeases).set({ leaseExpiresAt: new Date(input.at.getTime() + input.leaseMs), updatedAt: input.at }).where(and(eq(runtimeOperationProjectionLeases.workspaceId, input.workspaceId), eq(runtimeOperationProjectionLeases.leaseOwner, input.owner), gt(runtimeOperationProjectionLeases.leaseExpiresAt, input.at))).returning({ workspaceId: runtimeOperationProjectionLeases.workspaceId });
  return rows.length === 1;
}
