import "server-only";

import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { canonicalDigest } from "@/lib/agent-tools/canonical";
import { getDb } from "@/lib/db";
import { workspaceProductCommandReceipts, workspaceProductRecordRevisions, workspaceProductRecords } from "@/lib/db/schema";
import { PRODUCT_RECORD_KINDS, PRODUCT_STATES, parseProductPayload, productTransitionIssue, type ProductRecordKind } from "./definitions";

export type ProductRecord = typeof workspaceProductRecords.$inferSelect;
export type ProductRecordExecutor = Pick<ReturnType<typeof getDb>, "select" | "insert" | "update">;

export class ProductRecordConflictError extends Error {}
export class ProductRecordIdempotencyError extends Error {}
export class ProductRecordTransitionError extends Error {}

function assertState(kind: ProductRecordKind, state: string) {
  if (!PRODUCT_STATES[kind].includes(state)) throw new Error("Unsupported state for record kind.");
}

async function replayReceipt(executor: ProductRecordExecutor, input: { workspaceId: string; recordId: string; resultRevision: number }) {
  const [[record], [snapshot]] = await Promise.all([
    executor.select().from(workspaceProductRecords).where(and(eq(workspaceProductRecords.workspaceId, input.workspaceId), eq(workspaceProductRecords.id, input.recordId))).limit(1),
    executor.select().from(workspaceProductRecordRevisions).where(and(eq(workspaceProductRecordRevisions.workspaceId, input.workspaceId), eq(workspaceProductRecordRevisions.recordId, input.recordId), eq(workspaceProductRecordRevisions.revision, input.resultRevision))).limit(1),
  ]);
  if (!record || !snapshot) throw new Error("Idempotency receipt refers to missing product history.");
  return { ...record, title: snapshot.title, state: snapshot.state, revision: snapshot.revision, payload: snapshot.payload, updatedByUserId: snapshot.authorUserId, updatedAt: snapshot.createdAt };
}

export async function listProductRecords(input: {
  workspaceId: string;
  kinds?: ProductRecordKind[];
  includeArchived?: boolean;
  limit?: number;
}) {
  const filters = [eq(workspaceProductRecords.workspaceId, input.workspaceId)];
  if (input.kinds?.length) filters.push(inArray(workspaceProductRecords.kind, input.kinds));
  if (!input.includeArchived) filters.push(sql`${workspaceProductRecords.archivedAt} is null`);
  const rows = await getDb().select().from(workspaceProductRecords)
    .where(and(...filters)).orderBy(desc(workspaceProductRecords.updatedAt))
    .limit(Math.min(input.limit ?? 100, 250));
  return rows.map((row) => ({ ...row, kind: row.kind as ProductRecordKind, payload: parseProductPayload(row.kind as ProductRecordKind, row.payload) }));
}

export async function createProductRecord(input: {
  workspaceId: string;
  userId: string;
  kind: ProductRecordKind;
  title: string;
  state: string;
  payload: Record<string, unknown>;
  idempotencyKey: string;
  now?: Date;
}) {
  return getDb().transaction((tx) => createProductRecordInTransaction(tx, input));
}

export async function createProductRecordInTransaction(executor: ProductRecordExecutor, input: {
  workspaceId: string;
  userId: string;
  kind: ProductRecordKind;
  title: string;
  state: string;
  payload: Record<string, unknown>;
  idempotencyKey: string;
  now?: Date;
}) {
  assertState(input.kind, input.state);
  if (input.kind === "creator_persona" && input.state !== "draft") throw new ProductRecordTransitionError("CREATOR_PERSONA_MUST_START_AS_DRAFT");
  const payload = parseProductPayload(input.kind, input.payload);
  const digest = canonicalDigest({ kind: input.kind, title: input.title, state: input.state, payload });
  const now = input.now ?? new Date();
    const [receipt] = await executor.select().from(workspaceProductCommandReceipts).where(and(
      eq(workspaceProductCommandReceipts.workspaceId, input.workspaceId),
      eq(workspaceProductCommandReceipts.idempotencyKey, input.idempotencyKey),
    )).limit(1);
    if (receipt) {
      if (receipt.requestDigest !== digest) throw new ProductRecordIdempotencyError("Idempotency key was already used for another command.");
      return replayReceipt(executor, { workspaceId: input.workspaceId, recordId: receipt.recordId, resultRevision: receipt.resultRevision });
    }
    const id = randomUUID();
    const [record] = await executor.insert(workspaceProductRecords).values({
      workspaceId: input.workspaceId, id, kind: input.kind, title: input.title.trim(), state: input.state,
      revision: 1, payload, createdByUserId: input.userId, updatedByUserId: input.userId,
      createdAt: now, updatedAt: now,
    }).returning();
    await executor.insert(workspaceProductRecordRevisions).values({ workspaceId: input.workspaceId, recordId: id, revision: 1, title: input.title.trim(), state: input.state, payload, authorUserId: input.userId, createdAt: now });
    await executor.insert(workspaceProductCommandReceipts).values({ workspaceId: input.workspaceId, idempotencyKey: input.idempotencyKey, requestDigest: digest, recordId: id, resultRevision: 1, createdAt: now });
    return record;
}

export async function updateProductRecord(input: {
  workspaceId: string;
  userId: string;
  id: string;
  expectedKind?: ProductRecordKind;
  expectedRevision: number;
  title?: string;
  state?: string;
  payload?: Record<string, unknown>;
  idempotencyKey: string;
  now?: Date;
}) {
  return getDb().transaction((tx) => updateProductRecordInTransaction(tx, input));
}

export async function updateProductRecordInTransaction(executor: ProductRecordExecutor, input: {
  workspaceId: string;
  userId: string;
  id: string;
  expectedKind?: ProductRecordKind;
  expectedRevision: number;
  title?: string;
  state?: string;
  payload?: Record<string, unknown>;
  idempotencyKey: string;
  now?: Date;
}) {
  const now = input.now ?? new Date();
    const [current] = await executor.select().from(workspaceProductRecords).where(and(eq(workspaceProductRecords.workspaceId, input.workspaceId), eq(workspaceProductRecords.id, input.id))).limit(1);
    if (!current) return null;
    const kind = current.kind as ProductRecordKind;
    if (input.expectedKind && kind !== input.expectedKind) return null;
    const state = input.state ?? current.state;
    assertState(kind, state);
    const payload = input.payload ? parseProductPayload(kind, input.payload) : current.payload;
    const transitionIssue = productTransitionIssue({ kind, from: current.state, to: state, payload, now });
    if (transitionIssue) throw new ProductRecordTransitionError(transitionIssue);
    const title = input.title?.trim() ?? current.title;
    const digest = canonicalDigest({ id: input.id, expectedRevision: input.expectedRevision, title, state, payload });
    const [receipt] = await executor.select().from(workspaceProductCommandReceipts).where(and(eq(workspaceProductCommandReceipts.workspaceId, input.workspaceId), eq(workspaceProductCommandReceipts.idempotencyKey, input.idempotencyKey))).limit(1);
    if (receipt) {
      if (receipt.requestDigest !== digest) throw new ProductRecordIdempotencyError("Idempotency key was already used for another command.");
      return replayReceipt(executor, { workspaceId: input.workspaceId, recordId: receipt.recordId, resultRevision: receipt.resultRevision });
    }
    const [updated] = await executor.update(workspaceProductRecords).set({ title, state, payload, revision: sql`${workspaceProductRecords.revision} + 1`, updatedByUserId: input.userId, updatedAt: now, archivedAt: state === "archived" || state === "deleted" || state === "closed" ? now : null })
      .where(and(eq(workspaceProductRecords.workspaceId, input.workspaceId), eq(workspaceProductRecords.id, input.id), eq(workspaceProductRecords.revision, input.expectedRevision))).returning();
    if (!updated) throw new ProductRecordConflictError("The record changed on another device. Refresh and try again.");
    await executor.insert(workspaceProductRecordRevisions).values({ workspaceId: input.workspaceId, recordId: input.id, revision: updated.revision, title, state, payload, authorUserId: input.userId, createdAt: now });
    await executor.insert(workspaceProductCommandReceipts).values({ workspaceId: input.workspaceId, idempotencyKey: input.idempotencyKey, requestDigest: digest, recordId: input.id, resultRevision: updated.revision, createdAt: now });
    return updated;
}

export function isProductRecordKind(value: string): value is ProductRecordKind {
  return PRODUCT_RECORD_KINDS.includes(value as ProductRecordKind);
}
