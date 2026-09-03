import { createHash } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import type { getDb } from "@/lib/db";
import { productTelemetryEvents, releaseControlMutationReceipts, releaseControlRecords } from "./db-schema";

type Db = ReturnType<typeof getDb>;
export type ReleaseRecordKind = "evidence" | "flag" | "incident" | "recovery_objective" | "restore_drill" | "contract_migration" | "parity_requirement" | "experiment";
export interface StoredReleaseRecord { workspaceId: string; kind: ReleaseRecordKind; id: string; revision: number; buildId: string | null; document: Record<string, unknown>; createdByUserId: string; createdAt: Date; expiresAt: Date | null }

function digest(value: unknown): string { return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`; }

export class ReleaseControlConflictError extends Error { constructor() { super("IDEMPOTENCY_CONFLICT"); } }

export class ReleaseControlRepository {
  constructor(private readonly database: () => Db) {}

  async listLatest(workspaceId: string, kind?: ReleaseRecordKind): Promise<StoredReleaseRecord[]> {
    const rows = await this.database().selectDistinctOn([releaseControlRecords.kind, releaseControlRecords.id]).from(releaseControlRecords)
      .where(and(eq(releaseControlRecords.workspaceId, workspaceId), kind ? eq(releaseControlRecords.kind, kind) : undefined))
      .orderBy(releaseControlRecords.kind, releaseControlRecords.id, desc(releaseControlRecords.revision));
    return rows.map((row) => ({ ...row, kind: row.kind as ReleaseRecordKind, document: row.document, createdAt: new Date(row.createdAt), expiresAt: row.expiresAt ? new Date(row.expiresAt) : null }));
  }

  async listPublicIncidents(): Promise<Array<{ document: Record<string, unknown>; createdAt: Date }>> {
    const rows = await this.database().selectDistinctOn([releaseControlRecords.workspaceId, releaseControlRecords.id], { document: releaseControlRecords.document, createdAt: releaseControlRecords.createdAt })
      .from(releaseControlRecords).where(eq(releaseControlRecords.kind, "incident"))
      .orderBy(releaseControlRecords.workspaceId, releaseControlRecords.id, desc(releaseControlRecords.revision));
    return rows.map((row) => ({ document: row.document, createdAt: new Date(row.createdAt) }));
  }

  async append(input: { workspaceId: string; kind: ReleaseRecordKind; id: string; buildId: string | null; document: Record<string, unknown>; expiresAt: Date | null; userId: string; idempotencyKey: string; now: Date }): Promise<{ record: StoredReleaseRecord; replayed: boolean }> {
    const requestDigest = digest({ kind: input.kind, id: input.id, buildId: input.buildId, document: input.document });
    return this.database().transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`release:${input.workspaceId}:${input.kind}:${input.id}`}, 0))`);
      const [receipt] = await tx.select().from(releaseControlMutationReceipts).where(and(eq(releaseControlMutationReceipts.workspaceId, input.workspaceId), eq(releaseControlMutationReceipts.idempotencyKey, input.idempotencyKey))).limit(1);
      if (receipt) {
        if (receipt.requestDigest !== requestDigest) throw new ReleaseControlConflictError();
        return { record: receipt.response as unknown as StoredReleaseRecord, replayed: true };
      }
      const [current] = await tx.select({ revision: releaseControlRecords.revision }).from(releaseControlRecords).where(and(eq(releaseControlRecords.workspaceId, input.workspaceId), eq(releaseControlRecords.kind, input.kind), eq(releaseControlRecords.id, input.id))).orderBy(desc(releaseControlRecords.revision)).limit(1);
      const record: StoredReleaseRecord = { workspaceId: input.workspaceId, kind: input.kind, id: input.id, revision: (current?.revision ?? 0) + 1, buildId: input.buildId, document: input.document, createdByUserId: input.userId, createdAt: input.now, expiresAt: input.expiresAt };
      await tx.insert(releaseControlRecords).values(record);
      await tx.insert(releaseControlMutationReceipts).values({ workspaceId: input.workspaceId, idempotencyKey: input.idempotencyKey, requestDigest, response: record as unknown as Record<string, unknown>, createdAt: input.now });
      return { record, replayed: false };
    });
  }

  async appendTelemetry(input: { workspaceId: string; event: Record<string, unknown>; idempotencyKey: string; now: Date }): Promise<{ replayed: boolean }> {
    const requestDigest = digest(input.event);
    return this.database().transaction(async (tx) => {
      const [receipt] = await tx.select().from(releaseControlMutationReceipts).where(and(eq(releaseControlMutationReceipts.workspaceId, input.workspaceId), eq(releaseControlMutationReceipts.idempotencyKey, input.idempotencyKey))).limit(1);
      if (receipt) { if (receipt.requestDigest !== requestDigest) throw new ReleaseControlConflictError(); return { replayed: true }; }
      await tx.insert(productTelemetryEvents).values({ workspaceId: input.workspaceId, eventId: String(input.event.eventId), workspacePseudonym: String(input.event.workspacePseudonym), sessionPseudonym: String(input.event.sessionPseudonym), name: String(input.event.name), occurredAt: new Date(String(input.event.occurredAt)), receivedAt: input.now, event: input.event }).onConflictDoNothing();
      await tx.insert(releaseControlMutationReceipts).values({ workspaceId: input.workspaceId, idempotencyKey: input.idempotencyKey, requestDigest, response: { accepted: true }, createdAt: input.now });
      return { replayed: false };
    });
  }
}
