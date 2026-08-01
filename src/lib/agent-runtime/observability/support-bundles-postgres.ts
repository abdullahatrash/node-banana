import { and, asc, eq, inArray, lte, sql } from "drizzle-orm";
import type { getDb } from "@/lib/db";
import { runtimeSupportBundleBindIntents } from "@/lib/db/schema";
import type {
  SupportBundleBindIntent,
  SupportBundleBindIntentRepository,
} from "./support-bundles";
import { runWithSupportBundleDbExecutor } from "./support-bundles-db-context";

type Db = ReturnType<typeof getDb>;

const date = (value: Date | string) => value instanceof Date ? value : new Date(value);

function intent(row: typeof runtimeSupportBundleBindIntents.$inferSelect): SupportBundleBindIntent {
  return {
    schema: "support-bundle-bind-intent/v1",
    id: row.id,
    workspaceId: row.workspaceId,
    idempotencyKey: row.idempotencyKey,
    requestDigest: row.requestDigest as `sha256:${string}`,
    state: row.state as SupportBundleBindIntent["state"],
    selections: structuredClone(row.selections),
    consent: {
      ...structuredClone(row.consent),
      grantedAt: date(row.consent.grantedAt),
      expiresAt: date(row.consent.expiresAt),
    },
    contentDigest: row.contentDigest as `sha256:${string}`,
    sizeBytes: row.sizeBytes,
    storageKey: row.storageKey,
    payloadJson: row.payloadJson,
    bundleId: row.bundleId,
    createdAt: date(row.createdAt),
    updatedAt: date(row.updatedAt),
  };
}

export class DrizzleSupportBundleBindIntentRepository
  implements SupportBundleBindIntentRepository
{
  constructor(private readonly database: () => Db) {}

  withBindLock<T>(input: { workspaceId: string; idempotencyKey: string }, operation: () => Promise<T>) {
    return this.database().transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`runtime-support-bundle-bind:${input.workspaceId}:${input.idempotencyKey}`}, 0))`);
      // Drizzle PgTransaction exposes transaction() as a savepoint. The ALS
      // executor makes every nested intent/core repository call reuse this
      // connection instead of consuming another pool client.
      return runWithSupportBundleDbExecutor(tx as unknown as Db, operation);
    });
  }

  acquirePrepared(value: SupportBundleBindIntent) {
    return this.database().transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`runtime-observability:${value.workspaceId}`}, 0))`);
      await tx.insert(runtimeSupportBundleBindIntents).values({
        id: value.id,
        workspaceId: value.workspaceId,
        idempotencyKey: value.idempotencyKey,
        requestDigest: value.requestDigest,
        state: value.state,
        selections: value.selections,
        consent: value.consent,
        contentDigest: value.contentDigest,
        sizeBytes: value.sizeBytes,
        storageKey: value.storageKey,
        payloadJson: value.payloadJson,
        bundleId: value.bundleId,
        consentExpiresAt: value.consent.expiresAt,
        createdAt: value.createdAt,
        updatedAt: value.updatedAt,
      }).onConflictDoNothing();
      const [row] = await tx.select().from(runtimeSupportBundleBindIntents).where(and(
        eq(runtimeSupportBundleBindIntents.workspaceId, value.workspaceId),
        eq(runtimeSupportBundleBindIntents.idempotencyKey, value.idempotencyKey),
      )).limit(1);
      if (!row) return { kind: "unavailable" as const };
      if (row.requestDigest !== value.requestDigest) return { kind: "conflict" as const };
      return {
        kind: row.id === value.id && row.createdAt.getTime() === value.createdAt.getTime()
          ? "created" as const
          : "replayed" as const,
        intent: intent(row),
      };
    }).catch(() => ({ kind: "unavailable" as const }));
  }

  markBound(input: {
    workspaceId: string;
    idempotencyKey: string;
    requestDigest: `sha256:${string}`;
    bundleId: string;
    boundAt: Date;
  }) {
    return this.database().transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`runtime-observability:${input.workspaceId}`}, 0))`);
      const [row] = await tx.select().from(runtimeSupportBundleBindIntents).where(and(
        eq(runtimeSupportBundleBindIntents.workspaceId, input.workspaceId),
        eq(runtimeSupportBundleBindIntents.idempotencyKey, input.idempotencyKey),
      )).for("update");
      if (!row || row.requestDigest !== input.requestDigest) return "conflict" as const;
      if (row.state === "bound" || row.state === "cleanup") return row.bundleId === input.bundleId ? "replayed" as const : "conflict" as const;
      if (row.state !== "pending") return "conflict" as const;
      const [updated] = await tx.update(runtimeSupportBundleBindIntents).set({
        state: "bound",
        payloadJson: null,
        bundleId: input.bundleId,
        updatedAt: input.boundAt,
      }).where(and(
        eq(runtimeSupportBundleBindIntents.id, row.id),
        eq(runtimeSupportBundleBindIntents.state, "pending"),
        eq(runtimeSupportBundleBindIntents.requestDigest, input.requestDigest),
      )).returning({ id: runtimeSupportBundleBindIntents.id });
      return updated ? "bound" as const : "conflict" as const;
    }).catch(() => "unavailable" as const);
  }

  deferPending(input: { workspaceId: string; idempotencyKey: string; requestDigest: `sha256:${string}`; retryAt: Date }) {
    return this.database().transaction(async (tx) => {
      const [updated] = await tx.update(runtimeSupportBundleBindIntents).set({ updatedAt: input.retryAt }).where(and(
        eq(runtimeSupportBundleBindIntents.workspaceId, input.workspaceId),
        eq(runtimeSupportBundleBindIntents.idempotencyKey, input.idempotencyKey),
        eq(runtimeSupportBundleBindIntents.requestDigest, input.requestDigest),
        eq(runtimeSupportBundleBindIntents.state, "pending"),
      )).returning({ id: runtimeSupportBundleBindIntents.id });
      return updated ? "deferred" as const : "conflict" as const;
    }).catch(() => "unavailable" as const);
  }

  markAbandoned(input: { workspaceId: string; idempotencyKey: string; requestDigest: `sha256:${string}`; abandonedAt: Date }) {
    return this.database().transaction(async (tx) => {
      const [row] = await tx.select().from(runtimeSupportBundleBindIntents).where(and(
        eq(runtimeSupportBundleBindIntents.workspaceId, input.workspaceId),
        eq(runtimeSupportBundleBindIntents.idempotencyKey, input.idempotencyKey),
      )).for("update");
      if (!row || row.requestDigest !== input.requestDigest) return "conflict" as const;
      if (row.state === "abandoned") return "replayed" as const;
      if (row.state !== "pending") return "conflict" as const;
      const [updated] = await tx.update(runtimeSupportBundleBindIntents).set({
        state: "abandoned",
        payloadJson: null,
        bundleId: null,
        updatedAt: input.abandonedAt,
      }).where(and(
        eq(runtimeSupportBundleBindIntents.id, row.id),
        eq(runtimeSupportBundleBindIntents.state, "pending"),
        eq(runtimeSupportBundleBindIntents.requestDigest, input.requestDigest),
      )).returning({ id: runtimeSupportBundleBindIntents.id });
      return updated ? "abandoned" as const : "conflict" as const;
    }).catch(() => "unavailable" as const);
  }

  markCleanup(input: { workspaceId: string; bundleId: string; retryAt: Date }) {
    return this.database().transaction(async (tx) => {
      const [row] = await tx.select().from(runtimeSupportBundleBindIntents).where(and(
        eq(runtimeSupportBundleBindIntents.workspaceId, input.workspaceId),
        eq(runtimeSupportBundleBindIntents.bundleId, input.bundleId),
      )).for("update");
      if (!row) return "not_found" as const;
      if (row.state === "cleanup") return "replayed" as const;
      if (row.state !== "bound") return "conflict" as const;
      const [updated] = await tx.update(runtimeSupportBundleBindIntents).set({ state: "cleanup", updatedAt: input.retryAt }).where(and(
        eq(runtimeSupportBundleBindIntents.id, row.id),
        eq(runtimeSupportBundleBindIntents.state, "bound"),
      )).returning({ id: runtimeSupportBundleBindIntents.id });
      return updated ? "cleanup" as const : "conflict" as const;
    }).catch(() => "unavailable" as const);
  }

  deferCleanup(input: { id: string; retryAt: Date }) {
    return this.database().transaction(async (tx) => {
      const [updated] = await tx.update(runtimeSupportBundleBindIntents).set({ updatedAt: input.retryAt }).where(and(
        eq(runtimeSupportBundleBindIntents.id, input.id),
        inArray(runtimeSupportBundleBindIntents.state, ["cleanup", "abandoned"]),
      )).returning({ id: runtimeSupportBundleBindIntents.id });
      return updated ? "deferred" as const : "conflict" as const;
    }).catch(() => "unavailable" as const);
  }


  async listPending(input: { at: Date; limit: number }) {
    const rows = await this.database().select().from(runtimeSupportBundleBindIntents).where(and(
      eq(runtimeSupportBundleBindIntents.state, "pending"),
      lte(runtimeSupportBundleBindIntents.updatedAt, input.at),
    )).orderBy(
      asc(runtimeSupportBundleBindIntents.updatedAt),
      asc(runtimeSupportBundleBindIntents.id),
    ).limit(input.limit);
    return rows.map(intent);
  }

  async listCleanup(input: { at: Date; limit: number }) {
    const rows = await this.database().select().from(runtimeSupportBundleBindIntents).where(and(
      inArray(runtimeSupportBundleBindIntents.state, ["cleanup", "abandoned"]),
      lte(runtimeSupportBundleBindIntents.updatedAt, input.at),
    )).orderBy(asc(runtimeSupportBundleBindIntents.updatedAt), asc(runtimeSupportBundleBindIntents.id)).limit(input.limit);
    return rows.map(intent);
  }

}
