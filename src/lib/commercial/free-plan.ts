import "server-only";

import { sql } from "drizzle-orm";

import { getDb } from "@/lib/db";

type Db = ReturnType<typeof getDb>;
type Transaction = Parameters<Parameters<Db["transaction"]>[0]>[0];
type FreePlanExecutor = Pick<Db, "execute"> | Pick<Transaction, "execute">;

export const FREE_PLAN_ID = "free";
export const FREE_PLAN_VERSION = 1;
export const FREE_PLAN_CREDIT_UNITS = 10;

/**
 * Activates or repairs the current Free entitlement while preserving any
 * existing paid/trial subscription. The database function owns locking,
 * idempotency, renewal, audit-event, bucket, and ledger invariants.
 */
export async function ensureWorkspaceFreePlanInTransaction(
  executor: FreePlanExecutor,
  input: { workspaceId: string; now: Date },
): Promise<void> {
  if (!input.workspaceId.trim() || !Number.isFinite(input.now.getTime())) {
    throw new Error("FREE_PLAN_ACTIVATION_INPUT_INVALID");
  }

  await executor.execute(
    sql`select public.ensure_workspace_free_plan_v1(${input.workspaceId}, ${input.now})`,
  );
}

export async function ensureWorkspaceFreePlan(
  workspaceId: string,
  now = new Date(),
): Promise<void> {
  await getDb().transaction((tx) =>
    ensureWorkspaceFreePlanInTransaction(tx, { workspaceId, now }),
  );
}
