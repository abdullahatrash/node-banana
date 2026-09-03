import { and, asc, desc, eq, gt, inArray, max, ne, sql } from "drizzle-orm";
import type { getDb } from "@/lib/db";
import {
  workspaceAuditTrailEvents,
  workspaceGovernanceMutationReceipts,
  workspaceGovernanceResources,
  workspaceGovernanceSecretDeliveries,
  workspaceMembers,
  workspaces,
} from "@/lib/db/schema";
import type {
  GovernanceAuditEvent,
  GovernanceCanonicalEffect,
  GovernanceCommit,
  GovernanceCommitResult,
  GovernanceRepository,
  GovernanceReceipt,
  GovernanceResource,
  GovernanceResourceKind,
} from "./types";

type Db = ReturnType<typeof getDb>;

class GovernanceCommitConflict extends Error {}

async function applyCanonicalEffect(
  tx: Parameters<Parameters<Db["transaction"]>[0]>[0],
  effect: GovernanceCanonicalEffect,
): Promise<void> {
  if (effect.type === "membership_upsert") {
    await tx.insert(workspaceMembers).values({
      workspaceId: effect.workspaceId,
      userId: effect.userId,
      role: effect.role,
      updatedAt: effect.occurredAt,
    }).onConflictDoNothing();
    await tx.update(workspaceMembers).set({
      role: effect.role,
      updatedAt: effect.occurredAt,
    }).where(and(
      eq(workspaceMembers.workspaceId, effect.workspaceId),
      eq(workspaceMembers.userId, effect.userId),
      ne(workspaceMembers.role, "owner"),
    ));
    return;
  }
  if (effect.type === "membership_remove") {
    const [workspace] = await tx.select({ ownerUserId: workspaces.ownerUserId })
      .from(workspaces)
      .where(eq(workspaces.id, effect.workspaceId))
      .limit(1);
    if (!workspace || workspace.ownerUserId === effect.userId) throw new GovernanceCommitConflict();
    const removed = await tx.delete(workspaceMembers).where(and(
      eq(workspaceMembers.workspaceId, effect.workspaceId),
      eq(workspaceMembers.userId, effect.userId),
    )).returning({ userId: workspaceMembers.userId });
    if (!removed.length) throw new GovernanceCommitConflict();
    return;
  }
  if (effect.type === "membership_role_update") {
    const updated = await tx.update(workspaceMembers).set({
      role: effect.role,
      updatedAt: effect.occurredAt,
    }).where(and(
      eq(workspaceMembers.workspaceId, effect.workspaceId),
      eq(workspaceMembers.userId, effect.userId),
      ne(workspaceMembers.role, "owner"),
    )).returning({ userId: workspaceMembers.userId });
    if (!updated.length) throw new GovernanceCommitConflict();
    return;
  }
  if (effect.type === "ownership_transfer") {
    const target = await tx.select({ userId: workspaceMembers.userId })
      .from(workspaceMembers)
      .where(and(
        eq(workspaceMembers.workspaceId, effect.workspaceId),
        eq(workspaceMembers.userId, effect.newOwnerUserId),
      ))
      .limit(1);
    if (!target.length) throw new GovernanceCommitConflict();
    const changed = await tx.update(workspaces).set({
      ownerUserId: effect.newOwnerUserId,
      updatedAt: effect.occurredAt,
    }).where(and(
      eq(workspaces.id, effect.workspaceId),
      eq(workspaces.ownerUserId, effect.currentOwnerUserId),
    )).returning({ id: workspaces.id });
    if (!changed.length) throw new GovernanceCommitConflict();
    await tx.update(workspaceMembers).set({ role: "admin", updatedAt: effect.occurredAt }).where(and(
      eq(workspaceMembers.workspaceId, effect.workspaceId),
      eq(workspaceMembers.userId, effect.currentOwnerUserId),
    ));
    await tx.update(workspaceMembers).set({ role: "owner", updatedAt: effect.occurredAt }).where(and(
      eq(workspaceMembers.workspaceId, effect.workspaceId),
      eq(workspaceMembers.userId, effect.newOwnerUserId),
    ));
    return;
  }
  const closed = await tx.update(workspaces).set({
    deletedAt: effect.occurredAt,
    updatedAt: effect.occurredAt,
  }).where(and(
    eq(workspaces.id, effect.workspaceId),
    eq(workspaces.ownerUserId, effect.currentOwnerUserId),
  )).returning({ id: workspaces.id });
  if (!closed.length) throw new GovernanceCommitConflict();
}

function fromResourceRow<T>(
  row: typeof workspaceGovernanceResources.$inferSelect,
): GovernanceResource<T> {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    kind: row.kind as GovernanceResourceKind,
    version: row.version,
    status: row.status,
    body: structuredClone(row.body) as T,
    createdByUserId: row.createdByUserId,
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
  };
}

function fromAuditRow(
  row: typeof workspaceAuditTrailEvents.$inferSelect,
): GovernanceAuditEvent {
  const stored = row.event as unknown as Omit<GovernanceAuditEvent, "occurredAt"> & {
    occurredAt: string;
  };
  return {
    ...structuredClone(stored),
    sequence: row.sequence,
    occurredAt: new Date(row.occurredAt),
  };
}

export class DrizzleGovernanceRepository implements GovernanceRepository {
  constructor(private readonly database: () => Db) {}

  async findReceipt(input: {
    workspaceId: string;
    capability: string;
    idempotencyKey: string;
  }): Promise<GovernanceReceipt | null> {
    const [row] = await this.database()
      .select()
      .from(workspaceGovernanceMutationReceipts)
      .where(and(
        eq(workspaceGovernanceMutationReceipts.workspaceId, input.workspaceId),
        eq(workspaceGovernanceMutationReceipts.capability, input.capability),
        eq(workspaceGovernanceMutationReceipts.idempotencyKey, input.idempotencyKey),
      ))
      .limit(1);
    return row ? {
      workspaceId: row.workspaceId,
      capability: row.capability,
      idempotencyKey: row.idempotencyKey,
      requestDigest: row.requestDigest,
      result: structuredClone(row.result),
      createdAt: row.createdAt,
    } : null;
  }

  async findSecretDelivery(input: { workspaceId: string; capability: string; idempotencyKey: string }) {
    const [row] = await this.database().select().from(workspaceGovernanceSecretDeliveries).where(and(
      eq(workspaceGovernanceSecretDeliveries.workspaceId, input.workspaceId),
      eq(workspaceGovernanceSecretDeliveries.capability, input.capability),
      eq(workspaceGovernanceSecretDeliveries.idempotencyKey, input.idempotencyKey),
    )).limit(1);
    return row ? { ...row } : null;
  }

  async getResource<T = Record<string, unknown>>(input: {
    workspaceId: string;
    kind: GovernanceResourceKind;
    id: string;
  }): Promise<GovernanceResource<T> | null> {
    const [row] = await this.database()
      .select()
      .from(workspaceGovernanceResources)
      .where(
        and(
          eq(workspaceGovernanceResources.workspaceId, input.workspaceId),
          eq(workspaceGovernanceResources.kind, input.kind),
          eq(workspaceGovernanceResources.id, input.id),
        ),
      )
      .limit(1);
    return row ? fromResourceRow<T>(row) : null;
  }

  async listResources<T = Record<string, unknown>>(input: {
    workspaceId: string;
    kinds?: GovernanceResourceKind[];
    status?: string;
  }): Promise<GovernanceResource<T>[]> {
    const clauses = [eq(workspaceGovernanceResources.workspaceId, input.workspaceId)];
    if (input.kinds?.length) clauses.push(inArray(workspaceGovernanceResources.kind, input.kinds));
    if (input.status) clauses.push(eq(workspaceGovernanceResources.status, input.status));
    const rows = await this.database()
      .select()
      .from(workspaceGovernanceResources)
      .where(and(...clauses))
      .orderBy(desc(workspaceGovernanceResources.updatedAt), asc(workspaceGovernanceResources.id));
    return rows.map((row) => fromResourceRow<T>(row));
  }

  async listAudit(input: { workspaceId: string; afterSequence?: number; limit: number }) {
    const clauses = [eq(workspaceAuditTrailEvents.workspaceId, input.workspaceId)];
    if (input.afterSequence) clauses.push(gt(workspaceAuditTrailEvents.sequence, input.afterSequence));
    const rows = await this.database()
      .select()
      .from(workspaceAuditTrailEvents)
      .where(and(...clauses))
      .orderBy(asc(workspaceAuditTrailEvents.sequence))
      .limit(Math.min(Math.max(input.limit, 1), 500));
    return rows.map(fromAuditRow);
  }

  async commit(input: GovernanceCommit): Promise<GovernanceCommitResult> {
    if (
      input.audit.workspaceId !== input.receipt.workspaceId ||
      input.mutations.some((mutation) => mutation.resource.workspaceId !== input.receipt.workspaceId) ||
      input.canonicalEffects?.some((effect) => effect.workspaceId !== input.receipt.workspaceId)
    ) {
      return { type: "conflict" };
    }
    try {
      return await this.database().transaction(async (tx) => {
        const receiptLock = `${input.receipt.workspaceId}\u0000${input.receipt.capability}\u0000${input.receipt.idempotencyKey}`;
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${receiptLock}, 0))`);
        const [existing] = await tx
          .select()
          .from(workspaceGovernanceMutationReceipts)
          .where(
            and(
              eq(workspaceGovernanceMutationReceipts.workspaceId, input.receipt.workspaceId),
              eq(workspaceGovernanceMutationReceipts.capability, input.receipt.capability),
              eq(workspaceGovernanceMutationReceipts.idempotencyKey, input.receipt.idempotencyKey),
            ),
          )
          .limit(1);
        if (existing) {
          return existing.requestDigest === input.receipt.requestDigest
            ? { type: "replayed" as const, result: structuredClone(existing.result) }
            : { type: "conflict" as const };
        }

        for (const mutation of input.mutations) {
          const row = {
            workspaceId: mutation.resource.workspaceId,
            kind: mutation.resource.kind,
            id: mutation.resource.id,
            version: mutation.resource.version,
            status: mutation.resource.status,
            body: mutation.resource.body as Record<string, unknown>,
            createdByUserId: mutation.resource.createdByUserId,
            createdAt: mutation.resource.createdAt,
            updatedAt: mutation.resource.updatedAt,
          };
          if (mutation.type === "create") {
            const inserted = await tx
              .insert(workspaceGovernanceResources)
              .values(row)
              .onConflictDoNothing()
              .returning({ id: workspaceGovernanceResources.id });
            if (!inserted.length) throw new GovernanceCommitConflict();
          } else {
            const updated = await tx
              .update(workspaceGovernanceResources)
              .set({
                version: row.version,
                status: row.status,
                body: row.body,
                updatedAt: row.updatedAt,
              })
              .where(
                and(
                  eq(workspaceGovernanceResources.workspaceId, row.workspaceId),
                  eq(workspaceGovernanceResources.kind, row.kind),
                  eq(workspaceGovernanceResources.id, row.id),
                  eq(workspaceGovernanceResources.version, mutation.expectedVersion!),
                ),
              )
              .returning({ id: workspaceGovernanceResources.id });
            if (!updated.length) throw new GovernanceCommitConflict();
          }
        }

        for (const effect of input.canonicalEffects ?? []) {
          if (effect.workspaceId !== input.receipt.workspaceId) {
            throw new GovernanceCommitConflict();
          }
          await applyCanonicalEffect(tx, effect);
        }

        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${`workspace-audit:${input.audit.workspaceId}`}, 0))`,
        );
        const [head] = await tx
          .select({ sequence: max(workspaceAuditTrailEvents.sequence) })
          .from(workspaceAuditTrailEvents)
          .where(eq(workspaceAuditTrailEvents.workspaceId, input.audit.workspaceId));
        const sequence = Number(head?.sequence ?? 0) + 1;
        const storedEvent = {
          ...input.audit,
          sequence,
          occurredAt: input.audit.occurredAt.toISOString(),
        };
        await tx.insert(workspaceAuditTrailEvents).values({
          workspaceId: input.audit.workspaceId,
          sequence,
          id: input.audit.id,
          event: storedEvent as unknown as Record<string, unknown>,
          occurredAt: input.audit.occurredAt,
        });
        await tx.insert(workspaceGovernanceMutationReceipts).values({
          workspaceId: input.receipt.workspaceId,
          capability: input.receipt.capability,
          idempotencyKey: input.receipt.idempotencyKey,
          requestDigest: input.receipt.requestDigest,
          result: input.receipt.result,
          createdAt: input.receipt.createdAt,
        });
        if (input.secretDelivery) {
          await tx.insert(workspaceGovernanceSecretDeliveries).values(input.secretDelivery);
        }
        return { type: "committed" as const, result: structuredClone(input.receipt.result) };
      });
    } catch (error) {
      if (error instanceof GovernanceCommitConflict) return { type: "conflict" };
      throw error;
    }
  }
}
