import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { getDb } from "@/lib/db";
import { runtimeOperationEvents, runtimeOperationMutationReceipts, runtimeOperations } from "./db-schema";
import type { OperationStatusRepository } from "./repository";
import type { OperationEvent, OperationFilter, OperationMutationResult, OperationRecord } from "./types";

type Db = ReturnType<typeof getDb>;
const date = (value: Date | string) => value instanceof Date ? value : new Date(value);
function operation(row: typeof runtimeOperations.$inferSelect): OperationRecord { return { schema: "operation-status/v1", id: row.id, workspaceId: row.workspaceId, kind: row.kind as OperationRecord["kind"], resourceId: row.resourceId, state: row.state as OperationRecord["state"], stage: row.stage, revision: row.revision, actor: structuredClone(row.actor), metadata: structuredClone(row.metadata), retryOfOperationId: row.retryOfOperationId, createdAt: date(row.createdAt), updatedAt: date(row.updatedAt) }; }
function event(value: OperationEvent): OperationEvent { return { ...structuredClone(value), occurredAt: date(value.occurredAt) }; }

export class PostgresOperationStatusRepository implements OperationStatusRepository {
  constructor(private readonly database: () => Db) {}
  async replay(workspaceId: string, idempotencyKey: string, requestDigest: string): Promise<OperationMutationResult | null> {
    const [receipt] = await this.database().select().from(runtimeOperationMutationReceipts).where(and(eq(runtimeOperationMutationReceipts.workspaceId, workspaceId), eq(runtimeOperationMutationReceipts.idempotencyKey, idempotencyKey))).limit(1);
    if (!receipt) return null;
    if (receipt.requestDigest !== requestDigest) return { kind: "conflict" };
    const [row] = await this.database().select().from(runtimeOperations).where(and(eq(runtimeOperations.workspaceId, workspaceId), eq(runtimeOperations.id, receipt.operationId))).limit(1);
    return row ? { kind: "replayed", operation: operation(row) } : { kind: "unavailable" };
  }
  create(input: { operation: OperationRecord; event: OperationEvent; idempotencyKey: string; requestDigest: string }) { return this.write({ ...input, expectedRevision: 0 }); }
  transition(input: { operation: OperationRecord; event: OperationEvent; expectedRevision: number; idempotencyKey: string; requestDigest: string }) { return this.write(input); }
  private async write(input: { operation: OperationRecord; event: OperationEvent; expectedRevision: number; idempotencyKey: string; requestDigest: string }): Promise<OperationMutationResult> {
    try {
      return await this.database().transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`operation:${input.operation.workspaceId}:${input.operation.id}`}, 0))`);
        const [receipt] = await tx.select().from(runtimeOperationMutationReceipts).where(and(eq(runtimeOperationMutationReceipts.workspaceId, input.operation.workspaceId), eq(runtimeOperationMutationReceipts.idempotencyKey, input.idempotencyKey))).limit(1);
        if (receipt) {
          if (receipt.requestDigest !== input.requestDigest) return { kind: "conflict" as const };
          const [replayed] = await tx.select().from(runtimeOperations).where(and(eq(runtimeOperations.workspaceId, input.operation.workspaceId), eq(runtimeOperations.id, receipt.operationId))).limit(1);
          return replayed ? { kind: "replayed" as const, operation: operation(replayed) } : { kind: "unavailable" as const };
        }
        if (input.expectedRevision === 0) {
          const [created] = await tx.insert(runtimeOperations).values(input.operation).onConflictDoNothing().returning();
          if (!created) return { kind: "conflict" as const };
        } else {
          const [updated] = await tx.update(runtimeOperations).set({ state: input.operation.state, stage: input.operation.stage, revision: input.operation.revision, actor: input.operation.actor, metadata: input.operation.metadata, updatedAt: input.operation.updatedAt }).where(and(eq(runtimeOperations.workspaceId, input.operation.workspaceId), eq(runtimeOperations.id, input.operation.id), eq(runtimeOperations.revision, input.expectedRevision))).returning();
          if (!updated) return { kind: "conflict" as const };
        }
        await tx.insert(runtimeOperationEvents).values({ workspaceId: input.event.workspaceId, operationId: input.event.operationId, revision: input.event.revision, id: input.event.id, event: input.event, occurredAt: input.event.occurredAt });
        await tx.insert(runtimeOperationMutationReceipts).values({ workspaceId: input.operation.workspaceId, idempotencyKey: input.idempotencyKey, requestDigest: input.requestDigest, operationId: input.operation.id, createdAt: input.operation.updatedAt });
        return { kind: "applied" as const, operation: input.operation };
      });
    } catch { return { kind: "unavailable" }; }
  }
  async get(workspaceId: string, operationId: string) { const [row] = await this.database().select().from(runtimeOperations).where(and(eq(runtimeOperations.workspaceId, workspaceId), eq(runtimeOperations.id, operationId))).limit(1); return row ? operation(row) : null; }
  async list(workspaceId: string, filter: OperationFilter) { const rows = await this.database().select().from(runtimeOperations).where(and(eq(runtimeOperations.workspaceId, workspaceId), filter.states?.length ? inArray(runtimeOperations.state, filter.states) : undefined, filter.kinds?.length ? inArray(runtimeOperations.kind, filter.kinds) : undefined)).orderBy(desc(runtimeOperations.updatedAt), desc(runtimeOperations.id)).limit(filter.limit); return rows.map(operation); }
  async listEvents(workspaceId: string, operationId: string, limit: number) { const rows = await this.database().select({ value: runtimeOperationEvents.event }).from(runtimeOperationEvents).where(and(eq(runtimeOperationEvents.workspaceId, workspaceId), eq(runtimeOperationEvents.operationId, operationId))).orderBy(desc(runtimeOperationEvents.revision)).limit(limit); return rows.map((row) => event(row.value)).reverse(); }
}
