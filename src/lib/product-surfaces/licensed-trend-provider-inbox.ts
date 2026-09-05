import "server-only";

import { and, asc, eq, lt, lte, or, sql } from "drizzle-orm";

import { getDb } from "@/lib/db";
import {
  licensedTrendProviderCursors,
  licensedTrendProviderEvents,
} from "@/lib/db/schema";
import {
  LicensedTrendCatalogError,
  publishLicensedTrendCatalogRevision,
  setLicensedTrendCatalogStateFromProvider,
} from "./licensed-trend-catalog";
import type {
  LicensedTrendProviderEvent,
  LicensedTrendProviderEventIdentity,
} from "./licensed-trend-provider-contract";

type Database = ReturnType<typeof getDb>;
type ProviderEventRow = typeof licensedTrendProviderEvents.$inferSelect;
type ClaimedProviderEvent = ProviderEventRow & {
  leaseOwner: string;
  leaseExpiresAt: Date;
};

export class LicensedTrendProviderInboxError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

type ProviderEffects = {
  publish(document: Extract<LicensedTrendProviderEvent, { action: "publish_batch" }>['documents'][number]): Promise<unknown>;
  setState(input: { providerKey: string; catalogId: string; state: "active" | "paused" | "revoked" }): Promise<unknown>;
};

export async function applyLicensedTrendProviderEvent(input: {
  providerKey: string;
  payload: LicensedTrendProviderEvent;
  effects: ProviderEffects;
}) {
  if (input.payload.action === "publish_batch") {
    const results: unknown[] = [];
    for (const document of input.payload.documents) {
      results.push(await input.effects.publish(document));
    }
    return results;
  }
  return input.effects.setState({
    providerKey: input.providerKey,
    catalogId: input.payload.catalogId,
    state: input.payload.state,
  });
}

function sameInstant(left: Date, right: Date) {
  return left.getTime() === right.getTime();
}

export class LicensedTrendProviderInbox {
  constructor(
    private readonly database?: Database,
    private readonly effects: ProviderEffects = {
      publish: (document) => publishLicensedTrendCatalogRevision({ document }),
      setState: (input) => setLicensedTrendCatalogStateFromProvider(input),
    },
    private readonly now = () => new Date(),
  ) {}

  private get db() {
    return this.database ?? getDb();
  }

  async receive(input: {
    identity: LicensedTrendProviderEventIdentity;
    payload: LicensedTrendProviderEvent;
  }) {
    const at = this.now();
    await this.db.insert(licensedTrendProviderCursors).values({
      providerKey: input.identity.providerKey,
      lastSequence: 0,
      lastEventId: null,
      lastOccurredAt: null,
      updatedAt: at,
    }).onConflictDoNothing();
    const inserted = await this.db.insert(licensedTrendProviderEvents).values({
      providerKey: input.identity.providerKey,
      eventId: input.identity.eventId,
      sequence: input.identity.sequence,
      eventDigest: input.identity.eventDigest,
      keyId: input.identity.keyId,
      occurredAt: input.identity.occurredAt,
      receivedAt: at,
      payload: input.payload,
      state: "queued",
      attempt: 0,
      maxAttempts: 8,
      nextAttemptAt: at,
      leaseOwner: null,
      leaseExpiresAt: null,
      failureCode: null,
      operatorNote: null,
      finishedAt: null,
      updatedAt: at,
    }).onConflictDoNothing().returning();
    if (inserted[0]) return { kind: "accepted" as const, event: inserted[0] };

    const [existingById] = await this.db.select().from(licensedTrendProviderEvents).where(and(
      eq(licensedTrendProviderEvents.providerKey, input.identity.providerKey),
      eq(licensedTrendProviderEvents.eventId, input.identity.eventId),
    )).limit(1);
    if (!existingById) {
      throw new LicensedTrendProviderInboxError("LICENSED_TREND_PROVIDER_SEQUENCE_CONFLICT");
    }
    if (
      existingById.sequence !== input.identity.sequence
      || existingById.eventDigest !== input.identity.eventDigest
      || existingById.keyId !== input.identity.keyId
      || !sameInstant(existingById.occurredAt, input.identity.occurredAt)
    ) {
      throw new LicensedTrendProviderInboxError("LICENSED_TREND_PROVIDER_REPLAY_CONFLICT");
    }
    return { kind: "replayed" as const, event: existingById };
  }

  async run(input: { workerId: string; limit: number }) {
    const summary = { claimed: 0, succeeded: 0, retried: 0, failedKnown: 0, outcomeUnknown: 0 };
    const limit = Math.min(Math.max(Number.isInteger(input.limit) ? input.limit : 10, 1), 50);
    for (let index = 0; index < limit; index += 1) {
      const claim = await this.claim(input.workerId, this.now());
      if (!claim) break;
      summary.claimed += 1;
      try {
        await this.apply(claim);
        if (await this.complete(claim, this.now())) summary.succeeded += 1;
      } catch (error) {
        const result = await this.fail(claim, error, this.now());
        if (result === "queued") summary.retried += 1;
        else if (result === "failed_known") summary.failedKnown += 1;
        else if (result === "outcome_unknown") summary.outcomeUnknown += 1;
      }
    }
    return summary;
  }

  async retry(input: { providerKey: string; eventId: string }) {
    const at = this.now();
    const [updated] = await this.db.update(licensedTrendProviderEvents).set({
      state: "queued",
      attempt: 0,
      nextAttemptAt: at,
      leaseOwner: null,
      leaseExpiresAt: null,
      failureCode: null,
      operatorNote: null,
      finishedAt: null,
      updatedAt: at,
    }).where(and(
      eq(licensedTrendProviderEvents.providerKey, input.providerKey),
      eq(licensedTrendProviderEvents.eventId, input.eventId),
      or(
        eq(licensedTrendProviderEvents.state, "failed_known"),
        eq(licensedTrendProviderEvents.state, "outcome_unknown"),
      ),
    )).returning();
    if (!updated) throw new LicensedTrendProviderInboxError("LICENSED_TREND_PROVIDER_EVENT_NOT_RETRYABLE");
    return updated;
  }

  async skip(input: { providerKey: string; eventId: string; reason: string }) {
    const at = this.now();
    return this.db.transaction(async (tx) => {
      const [event] = await tx.select().from(licensedTrendProviderEvents).where(and(
        eq(licensedTrendProviderEvents.providerKey, input.providerKey),
        eq(licensedTrendProviderEvents.eventId, input.eventId),
      )).limit(1).for("update");
      if (!event || !["failed_known", "outcome_unknown"].includes(event.state)) {
        throw new LicensedTrendProviderInboxError("LICENSED_TREND_PROVIDER_EVENT_NOT_SKIPPABLE");
      }
      const [cursor] = await tx.select().from(licensedTrendProviderCursors).where(eq(
        licensedTrendProviderCursors.providerKey,
        input.providerKey,
      )).limit(1).for("update");
      if (!cursor || event.sequence !== cursor.lastSequence + 1) {
        throw new LicensedTrendProviderInboxError("LICENSED_TREND_PROVIDER_EVENT_NOT_NEXT");
      }
      await tx.update(licensedTrendProviderCursors).set({
        lastSequence: event.sequence,
        lastEventId: event.eventId,
        lastOccurredAt: event.occurredAt,
        updatedAt: at,
      }).where(and(
        eq(licensedTrendProviderCursors.providerKey, event.providerKey),
        eq(licensedTrendProviderCursors.lastSequence, cursor.lastSequence),
      ));
      const [skipped] = await tx.update(licensedTrendProviderEvents).set({
        state: "skipped",
        failureCode: event.failureCode ?? "OPERATOR_SKIPPED",
        operatorNote: input.reason,
        finishedAt: at,
        updatedAt: at,
      }).where(and(
        eq(licensedTrendProviderEvents.providerKey, event.providerKey),
        eq(licensedTrendProviderEvents.eventId, event.eventId),
        eq(licensedTrendProviderEvents.state, event.state),
      )).returning();
      if (!skipped) throw new LicensedTrendProviderInboxError("LICENSED_TREND_PROVIDER_SKIP_CONFLICT");
      return skipped;
    });
  }

  private async claim(workerId: string, at: Date): Promise<ClaimedProviderEvent | null> {
    const leaseExpiresAt = new Date(at.getTime() + 5 * 60_000);
    return this.db.transaction(async (tx) => {
      await tx.update(licensedTrendProviderEvents).set({
        state: "outcome_unknown",
        leaseOwner: null,
        leaseExpiresAt: null,
        failureCode: "LICENSED_TREND_PROVIDER_ATTEMPTS_EXHAUSTED",
        finishedAt: at,
        updatedAt: at,
      }).where(and(
        eq(licensedTrendProviderEvents.state, "claimed"),
        lte(licensedTrendProviderEvents.leaseExpiresAt, at),
        sql`${licensedTrendProviderEvents.attempt} >= ${licensedTrendProviderEvents.maxAttempts}`,
      ));
      const [due] = await tx.select({ event: licensedTrendProviderEvents })
        .from(licensedTrendProviderEvents)
        .innerJoin(
          licensedTrendProviderCursors,
          and(
            eq(licensedTrendProviderCursors.providerKey, licensedTrendProviderEvents.providerKey),
            sql`${licensedTrendProviderEvents.sequence} = ${licensedTrendProviderCursors.lastSequence} + 1`,
          ),
        )
        .where(and(
          lt(licensedTrendProviderEvents.attempt, licensedTrendProviderEvents.maxAttempts),
          or(
            and(eq(licensedTrendProviderEvents.state, "queued"), lte(licensedTrendProviderEvents.nextAttemptAt, at)),
            and(eq(licensedTrendProviderEvents.state, "claimed"), lte(licensedTrendProviderEvents.leaseExpiresAt, at)),
          ),
        ))
        .orderBy(asc(licensedTrendProviderEvents.nextAttemptAt), asc(licensedTrendProviderEvents.providerKey))
        .limit(1)
        .for("update", { skipLocked: true });
      if (!due) return null;
      const [claimed] = await tx.update(licensedTrendProviderEvents).set({
        state: "claimed",
        attempt: sql`${licensedTrendProviderEvents.attempt} + 1`,
        leaseOwner: workerId,
        leaseExpiresAt,
        failureCode: null,
        updatedAt: at,
      }).where(and(
        eq(licensedTrendProviderEvents.providerKey, due.event.providerKey),
        eq(licensedTrendProviderEvents.eventId, due.event.eventId),
        eq(licensedTrendProviderEvents.attempt, due.event.attempt),
      )).returning();
      if (!claimed?.leaseOwner || !claimed.leaseExpiresAt) return null;
      return claimed as ClaimedProviderEvent;
    });
  }

  private async apply(claim: ClaimedProviderEvent) {
    await applyLicensedTrendProviderEvent({
      providerKey: claim.providerKey,
      payload: claim.payload,
      effects: this.effects,
    });
  }

  private owned(claim: ClaimedProviderEvent) {
    return and(
      eq(licensedTrendProviderEvents.providerKey, claim.providerKey),
      eq(licensedTrendProviderEvents.eventId, claim.eventId),
      eq(licensedTrendProviderEvents.state, "claimed"),
      eq(licensedTrendProviderEvents.leaseOwner, claim.leaseOwner),
      eq(licensedTrendProviderEvents.attempt, claim.attempt),
    );
  }

  private async complete(claim: ClaimedProviderEvent, at: Date) {
    return this.db.transaction(async (tx) => {
      const [event] = await tx.select().from(licensedTrendProviderEvents).where(this.owned(claim)).limit(1).for("update");
      if (!event) return false;
      const [cursor] = await tx.select().from(licensedTrendProviderCursors).where(eq(
        licensedTrendProviderCursors.providerKey,
        claim.providerKey,
      )).limit(1).for("update");
      if (!cursor || event.sequence !== cursor.lastSequence + 1) return false;
      const [advanced] = await tx.update(licensedTrendProviderCursors).set({
        lastSequence: event.sequence,
        lastEventId: event.eventId,
        lastOccurredAt: event.occurredAt,
        updatedAt: at,
      }).where(and(
        eq(licensedTrendProviderCursors.providerKey, event.providerKey),
        eq(licensedTrendProviderCursors.lastSequence, cursor.lastSequence),
      )).returning();
      if (!advanced) throw new LicensedTrendProviderInboxError("LICENSED_TREND_PROVIDER_CURSOR_CONFLICT");
      const [completed] = await tx.update(licensedTrendProviderEvents).set({
        state: "succeeded",
        leaseOwner: null,
        leaseExpiresAt: null,
        failureCode: null,
        finishedAt: at,
        updatedAt: at,
      }).where(this.owned(claim)).returning();
      if (!completed) throw new LicensedTrendProviderInboxError("LICENSED_TREND_PROVIDER_LEASE_LOST");
      return true;
    });
  }

  private async fail(claim: ClaimedProviderEvent, error: unknown, at: Date) {
    const code = providerFailureCode(error);
    const state = providerFailureState({ error, attempt: claim.attempt, maxAttempts: claim.maxAttempts });
    const [updated] = await this.db.update(licensedTrendProviderEvents).set({
      state,
      leaseOwner: null,
      leaseExpiresAt: null,
      failureCode: code,
      nextAttemptAt: new Date(at.getTime() + Math.min(60, 2 ** claim.attempt) * 60_000),
      finishedAt: state === "queued" ? null : at,
      updatedAt: at,
    }).where(this.owned(claim)).returning({ state: licensedTrendProviderEvents.state });
    return updated?.state ?? "lease_lost";
  }
}

export function providerFailureCode(error: unknown) {
  const value = error instanceof LicensedTrendCatalogError
    ? error.code
    : error instanceof Error
      ? error.message
      : "LICENSED_TREND_PROVIDER_PROCESSING_FAILED";
  return /^[A-Z0-9_]{4,120}$/.test(value)
    ? value
    : "LICENSED_TREND_PROVIDER_PROCESSING_FAILED";
}

export function providerFailureState(input: { error: unknown; attempt: number; maxAttempts: number }) {
  const known = input.error instanceof LicensedTrendCatalogError && ![
    "CATALOG_OBJECT_IDENTITY_MISMATCH",
    "CATALOG_OBJECT_DIGEST_MISMATCH",
  ].includes(input.error.code);
  if (known) return "failed_known" as const;
  return input.attempt >= input.maxAttempts ? "outcome_unknown" as const : "queued" as const;
}

export const PRODUCTION_LICENSED_TREND_PROVIDER_INBOX = new LicensedTrendProviderInbox();
