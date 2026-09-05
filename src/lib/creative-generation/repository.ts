import { and, eq, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { CreativeError } from "./contracts";
import { creativeReceipts, creativeRevisions, creativeSessions } from "./db-schema";
import type { CreativeSession, CreativeSessionStore } from "./session";

export class PostgresCreativeSessionStore implements CreativeSessionStore {
  constructor(private readonly database: () => ReturnType<typeof getDb> = getDb) {}
  async get(workspaceId: string, id: string) {
    return (await this.database().select({ snapshot: creativeSessions.snapshot }).from(creativeSessions).where(and(eq(creativeSessions.workspaceId, workspaceId), eq(creativeSessions.id, id))).limit(1))[0]?.snapshot ?? null;
  }
  async create(session: CreativeSession, idempotencyKey: string, requestDigest: string) {
    return this.write({ workspaceId: session.workspaceId, id: session.id, userId: session.createdByUserId, expectedRevision: 0, idempotencyKey, requestDigest }, () => session);
  }
  async mutate(input: Parameters<CreativeSessionStore["mutate"]>[0], change: (current: CreativeSession) => CreativeSession) {
    return this.write(input, (current) => {
      if (!current) throw new CreativeError("creative.errors.notFound");
      const next = change(structuredClone(current));
      if (next.id !== current.id || next.workspaceId !== current.workspaceId || next.request !== current.request && JSON.stringify(next.request) !== JSON.stringify(current.request)) throw new CreativeError("creative.errors.requestImmutable");
      return { ...next, revision: current.revision + 1, updatedAt: new Date().toISOString() };
    });
  }
  private async write(input: Parameters<CreativeSessionStore["mutate"]>[0], change: (current: CreativeSession | null) => CreativeSession) {
    return this.database().transaction(async (tx) => {
      // Serialize the idempotency receipt and optimistic revision together.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`creative:${input.workspaceId}`}))`);
      const [receipt] = await tx.select().from(creativeReceipts).where(and(eq(creativeReceipts.workspaceId, input.workspaceId), eq(creativeReceipts.idempotencyKey, input.idempotencyKey))).limit(1);
      if (receipt) {
        if (receipt.requestDigest !== input.requestDigest) throw new CreativeError("creative.errors.idempotencyConflict");
        const [revision] = await tx.select().from(creativeRevisions).where(and(eq(creativeRevisions.workspaceId, input.workspaceId), eq(creativeRevisions.id, receipt.sessionId), eq(creativeRevisions.revision, receipt.revision))).limit(1);
        if (!revision) throw new CreativeError("creative.errors.persistence");
        return revision.snapshot;
      }
      const [stored] = await tx.select().from(creativeSessions).where(and(eq(creativeSessions.workspaceId, input.workspaceId), eq(creativeSessions.id, input.id))).limit(1);
      if ((stored?.revision ?? 0) !== input.expectedRevision) throw new CreativeError("creative.errors.revisionConflict");
      const next = change(stored?.snapshot ?? null);
      if (stored) await tx.update(creativeSessions).set({ revision: next.revision, snapshot: next, updatedAt: new Date(next.updatedAt) }).where(and(eq(creativeSessions.workspaceId, input.workspaceId), eq(creativeSessions.id, input.id)));
      else await tx.insert(creativeSessions).values({ workspaceId: next.workspaceId, id: next.id, revision: next.revision, snapshot: next, updatedAt: new Date(next.updatedAt) });
      await tx.insert(creativeRevisions).values({ workspaceId: next.workspaceId, id: next.id, revision: next.revision, snapshot: next, authorUserId: input.userId, createdAt: new Date(next.updatedAt) });
      await tx.insert(creativeReceipts).values({ workspaceId: next.workspaceId, idempotencyKey: input.idempotencyKey, requestDigest: input.requestDigest, sessionId: next.id, revision: next.revision });
      return next;
    });
  }
}
