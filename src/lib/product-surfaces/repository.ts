import "server-only";

import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { canonicalDigest } from "@/lib/agent-tools/canonical";
import { getDb } from "@/lib/db";
import { workspaceProductCommandReceipts, workspaceProductRecordRevisions, workspaceProductRecords } from "@/lib/db/schema";
import { PRODUCT_RECORD_KINDS, PRODUCT_STATES, parseProductPayload, type ProductRecordKind } from "./definitions";

export type ProductRecord = typeof workspaceProductRecords.$inferSelect;

export class ProductRecordConflictError extends Error {}
export class ProductRecordIdempotencyError extends Error {}

function assertState(kind: ProductRecordKind, state: string) {
  if (!PRODUCT_STATES[kind].includes(state)) throw new Error("Unsupported state for record kind.");
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
  assertState(input.kind, input.state);
  const payload = parseProductPayload(input.kind, input.payload);
  const digest = canonicalDigest({ kind: input.kind, title: input.title, state: input.state, payload });
  const now = input.now ?? new Date();
  return getDb().transaction(async (tx) => {
    const [receipt] = await tx.select().from(workspaceProductCommandReceipts).where(and(
      eq(workspaceProductCommandReceipts.workspaceId, input.workspaceId),
      eq(workspaceProductCommandReceipts.idempotencyKey, input.idempotencyKey),
    )).limit(1);
    if (receipt) {
      if (receipt.requestDigest !== digest) throw new ProductRecordIdempotencyError("Idempotency key was already used for another command.");
      const [existing] = await tx.select().from(workspaceProductRecords).where(and(eq(workspaceProductRecords.workspaceId, input.workspaceId), eq(workspaceProductRecords.id, receipt.recordId))).limit(1);
      if (!existing) throw new Error("Idempotency receipt refers to a missing record.");
      return existing;
    }
    const id = randomUUID();
    const [record] = await tx.insert(workspaceProductRecords).values({
      workspaceId: input.workspaceId, id, kind: input.kind, title: input.title.trim(), state: input.state,
      revision: 1, payload, createdByUserId: input.userId, updatedByUserId: input.userId,
      createdAt: now, updatedAt: now,
    }).returning();
    await tx.insert(workspaceProductRecordRevisions).values({ workspaceId: input.workspaceId, recordId: id, revision: 1, title: input.title.trim(), state: input.state, payload, authorUserId: input.userId, createdAt: now });
    await tx.insert(workspaceProductCommandReceipts).values({ workspaceId: input.workspaceId, idempotencyKey: input.idempotencyKey, requestDigest: digest, recordId: id, resultRevision: 1, createdAt: now });
    return record;
  });
}

export async function updateProductRecord(input: {
  workspaceId: string;
  userId: string;
  id: string;
  expectedRevision: number;
  title?: string;
  state?: string;
  payload?: Record<string, unknown>;
  idempotencyKey: string;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  return getDb().transaction(async (tx) => {
    const [current] = await tx.select().from(workspaceProductRecords).where(and(eq(workspaceProductRecords.workspaceId, input.workspaceId), eq(workspaceProductRecords.id, input.id))).limit(1);
    if (!current) return null;
    const kind = current.kind as ProductRecordKind;
    const state = input.state ?? current.state;
    assertState(kind, state);
    const payload = input.payload ? parseProductPayload(kind, input.payload) : current.payload;
    const title = input.title?.trim() ?? current.title;
    const digest = canonicalDigest({ id: input.id, expectedRevision: input.expectedRevision, title, state, payload });
    const [receipt] = await tx.select().from(workspaceProductCommandReceipts).where(and(eq(workspaceProductCommandReceipts.workspaceId, input.workspaceId), eq(workspaceProductCommandReceipts.idempotencyKey, input.idempotencyKey))).limit(1);
    if (receipt) {
      if (receipt.requestDigest !== digest) throw new ProductRecordIdempotencyError("Idempotency key was already used for another command.");
      return current;
    }
    const [updated] = await tx.update(workspaceProductRecords).set({ title, state, payload, revision: sql`${workspaceProductRecords.revision} + 1`, updatedByUserId: input.userId, updatedAt: now, archivedAt: state === "archived" || state === "deleted" || state === "closed" ? now : null })
      .where(and(eq(workspaceProductRecords.workspaceId, input.workspaceId), eq(workspaceProductRecords.id, input.id), eq(workspaceProductRecords.revision, input.expectedRevision))).returning();
    if (!updated) throw new ProductRecordConflictError("The record changed on another device. Refresh and try again.");
    await tx.insert(workspaceProductRecordRevisions).values({ workspaceId: input.workspaceId, recordId: input.id, revision: updated.revision, title, state, payload, authorUserId: input.userId, createdAt: now });
    await tx.insert(workspaceProductCommandReceipts).values({ workspaceId: input.workspaceId, idempotencyKey: input.idempotencyKey, requestDigest: digest, recordId: input.id, resultRevision: updated.revision, createdAt: now });
    return updated;
  });
}

export function isProductRecordKind(value: string): value is ProductRecordKind {
  return PRODUCT_RECORD_KINDS.includes(value as ProductRecordKind);
}
