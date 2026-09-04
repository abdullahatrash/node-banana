import "server-only";
import { createHash } from "node:crypto";
import { and, asc, desc, eq, inArray, lt, lte, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { marketingAttributionConsents, marketingAttributionDeliveryReceipts, marketingAttributionEvents, marketingAttributionMutationReceipts } from "@/lib/db/schema";
import type { MarketingAttributionConsent, MarketingAttributionEvent, MarketingAttributionEventName, XAdsConversionPayload } from "./types";

function digest(value: unknown): string { return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`; }
function consent(row: typeof marketingAttributionConsents.$inferSelect): MarketingAttributionConsent {
  return { schema: "marketing-attribution-consent/v1", ...row, provider: "x_ads", purpose: "advertising_attribution", status: row.status as "active" | "revoked", issuedAt: new Date(row.issuedAt), expiresAt: new Date(row.expiresAt) };
}
function event(row: typeof marketingAttributionEvents.$inferSelect): MarketingAttributionEvent {
  return { ...row, provider: "x_ads", eventName: row.eventName as MarketingAttributionEventName, payload: row.payload as unknown as XAdsConversionPayload, state: row.state as MarketingAttributionEvent["state"], nextAttemptAt: new Date(row.nextAttemptAt), leaseExpiresAt: row.leaseExpiresAt ? new Date(row.leaseExpiresAt) : null, occurredAt: new Date(row.occurredAt), createdAt: new Date(row.createdAt), updatedAt: new Date(row.updatedAt), finishedAt: row.finishedAt ? new Date(row.finishedAt) : null, expiresAt: new Date(row.expiresAt) };
}

export class MarketingAttributionConflictError extends Error { constructor() { super("IDEMPOTENCY_CONFLICT"); } }

export class MarketingAttributionRepository {
  async getConsent(workspaceId: string, userId: string): Promise<MarketingAttributionConsent | null> {
    const [row] = await getDb().select().from(marketingAttributionConsents).where(and(eq(marketingAttributionConsents.workspaceId, workspaceId), eq(marketingAttributionConsents.userId, userId), eq(marketingAttributionConsents.provider, "x_ads"))).orderBy(desc(marketingAttributionConsents.revision)).limit(1);
    return row ? consent(row) : null;
  }

  async counts(workspaceId: string, userId: string): Promise<{ pending: number; delivered: number }> {
    const rows = await getDb().select({ state: marketingAttributionEvents.state, count: sql<number>`count(*)::int` }).from(marketingAttributionEvents).where(and(eq(marketingAttributionEvents.workspaceId, workspaceId), eq(marketingAttributionEvents.userId, userId), eq(marketingAttributionEvents.provider, "x_ads"))).groupBy(marketingAttributionEvents.state);
    return { pending: rows.filter((row) => ["queued", "delivering"].includes(row.state)).reduce((sum, row) => sum + row.count, 0), delivered: rows.find((row) => row.state === "delivered")?.count ?? 0 };
  }

  async setConsent(input: { workspaceId: string; userId: string; status: "active" | "revoked"; noticeVersion: string; regionReviewVersion: string; expiresAt: Date; idempotencyKey: string; now: Date }): Promise<{ consent: MarketingAttributionConsent; replayed: boolean; scrubbedPendingEvents: number }> {
    const requestDigest = digest(input.status === "revoked" ? { type: "x_ads_consent", status: input.status } : { type: "x_ads_consent", status: input.status, noticeVersion: input.noticeVersion, regionReviewVersion: input.regionReviewVersion, expiresAt: input.expiresAt.toISOString() });
    return getDb().transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`marketing-consent:${input.workspaceId}:${input.userId}:x_ads`}, 0))`);
      const [existing] = await tx.select().from(marketingAttributionMutationReceipts).where(and(eq(marketingAttributionMutationReceipts.workspaceId, input.workspaceId), eq(marketingAttributionMutationReceipts.idempotencyKey, input.idempotencyKey))).limit(1);
      if (existing) {
        if (existing.requestDigest !== requestDigest) throw new MarketingAttributionConflictError();
        const response = existing.response as { consent: MarketingAttributionConsent; scrubbedPendingEvents: number };
        return { ...response, consent: { ...response.consent, issuedAt: new Date(response.consent.issuedAt), expiresAt: new Date(response.consent.expiresAt) }, replayed: true };
      }
      const [current] = await tx.select({ revision: marketingAttributionConsents.revision }).from(marketingAttributionConsents).where(and(eq(marketingAttributionConsents.workspaceId, input.workspaceId), eq(marketingAttributionConsents.userId, input.userId), eq(marketingAttributionConsents.provider, "x_ads"))).orderBy(desc(marketingAttributionConsents.revision)).limit(1);
      const value: MarketingAttributionConsent = { schema: "marketing-attribution-consent/v1", workspaceId: input.workspaceId, userId: input.userId, provider: "x_ads", revision: (current?.revision ?? 0) + 1, purpose: "advertising_attribution", status: input.status, noticeVersion: input.noticeVersion, regionReviewVersion: input.regionReviewVersion, issuedAt: input.now, expiresAt: input.expiresAt };
      await tx.insert(marketingAttributionConsents).values(value);
      let scrubbedPendingEvents = 0;
      if (input.status === "revoked") {
        const rows = await tx.update(marketingAttributionEvents).set({ state: "cancelled", payload: {}, failureCode: "CONSENT_REVOKED", finishedAt: input.now, updatedAt: input.now, leaseOwner: null, leaseExpiresAt: null }).where(and(eq(marketingAttributionEvents.workspaceId, input.workspaceId), eq(marketingAttributionEvents.userId, input.userId), eq(marketingAttributionEvents.provider, "x_ads"), inArray(marketingAttributionEvents.state, ["queued", "failed_known"]))).returning({ id: marketingAttributionEvents.id });
        scrubbedPendingEvents = rows.length;
      }
      const response = { consent: value, scrubbedPendingEvents };
      await tx.insert(marketingAttributionMutationReceipts).values({ workspaceId: input.workspaceId, idempotencyKey: input.idempotencyKey, requestDigest, response: response as unknown as Record<string, unknown>, createdAt: input.now, expiresAt: new Date(input.now.getTime() + 366 * 86_400_000) });
      return { ...response, replayed: false };
    });
  }

  async enqueue(input: { workspaceId: string; userId: string; eventName: MarketingAttributionEventName; payload: XAdsConversionPayload; consentRevision: number; idempotencyKey: string; now: Date; expiresAt: Date }): Promise<{ event: MarketingAttributionEvent; replayed: boolean }> {
    const requestDigest = digest({ type: "x_ads_event", eventName: input.eventName, payload: input.payload, consentRevision: input.consentRevision });
    return getDb().transaction(async (tx) => {
      const [existing] = await tx.select().from(marketingAttributionMutationReceipts).where(and(eq(marketingAttributionMutationReceipts.workspaceId, input.workspaceId), eq(marketingAttributionMutationReceipts.idempotencyKey, input.idempotencyKey))).limit(1);
      if (existing) {
        if (existing.requestDigest !== requestDigest) throw new MarketingAttributionConflictError();
        const response = existing.response as unknown as MarketingAttributionEvent;
        return { event: event(response as unknown as typeof marketingAttributionEvents.$inferSelect), replayed: true };
      }
      const [latest] = await tx.select().from(marketingAttributionConsents).where(and(eq(marketingAttributionConsents.workspaceId, input.workspaceId), eq(marketingAttributionConsents.userId, input.userId), eq(marketingAttributionConsents.provider, "x_ads"))).orderBy(desc(marketingAttributionConsents.revision)).limit(1);
      if (!latest || latest.revision !== input.consentRevision || latest.status !== "active" || latest.expiresAt <= input.now) throw new TypeError("ATTRIBUTION_CONSENT_REQUIRED");
      const eventId = `mae_${createHash("sha256").update(`${input.workspaceId}:${input.idempotencyKey}`).digest("hex").slice(0, 32)}`;
      const row: typeof marketingAttributionEvents.$inferInsert = { workspaceId: input.workspaceId, id: eventId, userId: input.userId, provider: "x_ads", eventName: input.eventName, conversionId: input.payload.conversion_id, consentRevision: input.consentRevision, payload: input.payload as unknown as Record<string, unknown>, state: "queued", attempt: 0, maxAttempts: 6, nextAttemptAt: input.now, leaseOwner: null, leaseExpiresAt: null, failureCode: null, occurredAt: new Date(input.payload.conversion_time), createdAt: input.now, updatedAt: input.now, finishedAt: null, expiresAt: input.expiresAt };
      const [stored] = await tx.insert(marketingAttributionEvents).values(row).returning();
      const value = event(stored!);
      await tx.insert(marketingAttributionMutationReceipts).values({ workspaceId: input.workspaceId, idempotencyKey: input.idempotencyKey, requestDigest, response: value as unknown as Record<string, unknown>, createdAt: input.now, expiresAt: new Date(input.now.getTime() + 366 * 86_400_000) });
      return { event: value, replayed: false };
    });
  }

  async claim(workerId: string, now: Date, receiptRetentionDays: number): Promise<MarketingAttributionEvent | null> {
    return getDb().transaction(async (tx) => {
      for (let inspected = 0; inspected < 25; inspected += 1) {
        const [expiredLease] = await tx.select().from(marketingAttributionEvents).where(and(eq(marketingAttributionEvents.state, "delivering"), lte(marketingAttributionEvents.leaseExpiresAt, now))).orderBy(asc(marketingAttributionEvents.leaseExpiresAt), asc(marketingAttributionEvents.id)).limit(1).for("update", { skipLocked: true });
        if (expiredLease) {
          const terminal = expiredLease.attempt >= expiredLease.maxAttempts;
          const receiptExpiresAt = new Date(now.getTime() + receiptRetentionDays * 86_400_000);
          await tx.update(marketingAttributionEvents).set({ state: terminal ? "outcome_unknown" : "queued", payload: terminal ? {} : expiredLease.payload, failureCode: "DELIVERY_LEASE_EXPIRED", leaseOwner: null, leaseExpiresAt: null, nextAttemptAt: now, finishedAt: terminal ? now : null, updatedAt: now, ...(terminal ? { expiresAt: receiptExpiresAt } : {}) }).where(and(eq(marketingAttributionEvents.workspaceId, expiredLease.workspaceId), eq(marketingAttributionEvents.id, expiredLease.id), eq(marketingAttributionEvents.state, "delivering")));
          if (terminal) await tx.insert(marketingAttributionDeliveryReceipts).values({ workspaceId: expiredLease.workspaceId, eventId: expiredLease.id, provider: "x_ads", conversionId: expiredLease.conversionId, eventName: expiredLease.eventName, outcome: "outcome_unknown", requestDigest: digest(expiredLease.payload), providerDebugId: null, deliveredAt: now, expiresAt: receiptExpiresAt }).onConflictDoNothing();
          continue;
        }
        const [row] = await tx.select().from(marketingAttributionEvents).where(and(eq(marketingAttributionEvents.state, "queued"), lte(marketingAttributionEvents.nextAttemptAt, now), lt(marketingAttributionEvents.attempt, marketingAttributionEvents.maxAttempts))).orderBy(asc(marketingAttributionEvents.nextAttemptAt), asc(marketingAttributionEvents.id)).limit(1).for("update", { skipLocked: true });
        if (!row) return null;
        const [latest] = await tx.select().from(marketingAttributionConsents).where(and(eq(marketingAttributionConsents.workspaceId, row.workspaceId), eq(marketingAttributionConsents.userId, row.userId), eq(marketingAttributionConsents.provider, "x_ads"))).orderBy(desc(marketingAttributionConsents.revision)).limit(1);
        if (!latest || latest.revision !== row.consentRevision || latest.status !== "active" || latest.expiresAt <= now) {
          await tx.update(marketingAttributionEvents).set({ state: "cancelled", payload: {}, failureCode: "CONSENT_NOT_ACTIVE", finishedAt: now, updatedAt: now }).where(and(eq(marketingAttributionEvents.workspaceId, row.workspaceId), eq(marketingAttributionEvents.id, row.id)));
          continue;
        }
        const [claimed] = await tx.update(marketingAttributionEvents).set({ state: "delivering", attempt: sql`${marketingAttributionEvents.attempt} + 1`, leaseOwner: workerId, leaseExpiresAt: new Date(now.getTime() + 60_000), updatedAt: now }).where(and(eq(marketingAttributionEvents.workspaceId, row.workspaceId), eq(marketingAttributionEvents.id, row.id), eq(marketingAttributionEvents.state, "queued"))).returning();
        if (claimed) return event(claimed);
      }
      return null;
    });
  }

  async consentStillAuthorizes(value: MarketingAttributionEvent, now: Date, requiredNoticeVersion: string, requiredRegionReviewVersion: string): Promise<boolean> {
    const latest = await this.getConsent(value.workspaceId, value.userId);
    return Boolean(latest && latest.status === "active" && latest.revision === value.consentRevision && latest.expiresAt > now && latest.noticeVersion === requiredNoticeVersion && latest.regionReviewVersion === requiredRegionReviewVersion);
  }

  async cancelClaim(value: MarketingAttributionEvent, now: Date, code: string): Promise<void> {
    await getDb().update(marketingAttributionEvents).set({ state: "cancelled", payload: {}, failureCode: code, leaseOwner: null, leaseExpiresAt: null, finishedAt: now, updatedAt: now }).where(and(eq(marketingAttributionEvents.workspaceId, value.workspaceId), eq(marketingAttributionEvents.id, value.id), eq(marketingAttributionEvents.state, "delivering"), eq(marketingAttributionEvents.leaseOwner, value.leaseOwner!)));
  }

  async delivered(value: MarketingAttributionEvent, result: { debugId: string | null }, now: Date, receiptRetentionDays: number): Promise<void> {
    await getDb().transaction(async (tx) => {
      const receiptExpiresAt = new Date(now.getTime() + receiptRetentionDays * 86_400_000);
      const [updated] = await tx.update(marketingAttributionEvents).set({ state: "delivered", payload: {}, failureCode: null, leaseOwner: null, leaseExpiresAt: null, finishedAt: now, updatedAt: now, expiresAt: receiptExpiresAt }).where(and(eq(marketingAttributionEvents.workspaceId, value.workspaceId), eq(marketingAttributionEvents.id, value.id), eq(marketingAttributionEvents.state, "delivering"), eq(marketingAttributionEvents.leaseOwner, value.leaseOwner!))).returning({ id: marketingAttributionEvents.id });
      if (!updated) return;
      await tx.insert(marketingAttributionDeliveryReceipts).values({ workspaceId: value.workspaceId, eventId: value.id, provider: "x_ads", conversionId: value.conversionId, eventName: value.eventName, outcome: "accepted", requestDigest: digest(value.payload), providerDebugId: result.debugId, deliveredAt: now, expiresAt: receiptExpiresAt }).onConflictDoNothing();
    });
  }

  async failed(value: MarketingAttributionEvent, input: { code: string; retryable: boolean; outcomeUnknown: boolean; now: Date; receiptRetentionDays: number }): Promise<"queued" | "failed_known" | "outcome_unknown" | "lost_lease"> {
    const terminal = !input.retryable || value.attempt >= value.maxAttempts;
    const state = terminal ? (input.outcomeUnknown ? "outcome_unknown" : "failed_known") : "queued";
    return getDb().transaction(async (tx) => {
      const receiptExpiresAt = new Date(input.now.getTime() + input.receiptRetentionDays * 86_400_000);
      const [updated] = await tx.update(marketingAttributionEvents).set({ state, payload: terminal ? {} : value.payload as unknown as Record<string, unknown>, failureCode: input.code.slice(0, 200), leaseOwner: null, leaseExpiresAt: null, nextAttemptAt: new Date(input.now.getTime() + Math.min(60, 2 ** value.attempt) * 60_000), finishedAt: terminal ? input.now : null, updatedAt: input.now, ...(state === "outcome_unknown" ? { expiresAt: receiptExpiresAt } : {}) }).where(and(eq(marketingAttributionEvents.workspaceId, value.workspaceId), eq(marketingAttributionEvents.id, value.id), eq(marketingAttributionEvents.state, "delivering"), eq(marketingAttributionEvents.leaseOwner, value.leaseOwner!))).returning({ id: marketingAttributionEvents.id });
      if (!updated) return "lost_lease";
      if (state === "outcome_unknown") await tx.insert(marketingAttributionDeliveryReceipts).values({ workspaceId: value.workspaceId, eventId: value.id, provider: "x_ads", conversionId: value.conversionId, eventName: value.eventName, outcome: "outcome_unknown", requestDigest: digest(value.payload), providerDebugId: null, deliveredAt: input.now, expiresAt: receiptExpiresAt }).onConflictDoNothing();
      return state;
    });
  }

  async deleteExpired(now: Date, limit: number): Promise<{ receipts: number; events: number; mutations: number }> {
    return getDb().transaction(async (tx) => {
      const receiptRows = await tx.select({ workspaceId: marketingAttributionDeliveryReceipts.workspaceId, eventId: marketingAttributionDeliveryReceipts.eventId }).from(marketingAttributionDeliveryReceipts).where(lte(marketingAttributionDeliveryReceipts.expiresAt, now)).limit(limit);
      for (const row of receiptRows) {
        await tx.delete(marketingAttributionDeliveryReceipts).where(and(eq(marketingAttributionDeliveryReceipts.workspaceId, row.workspaceId), eq(marketingAttributionDeliveryReceipts.eventId, row.eventId)));
        await tx.delete(marketingAttributionEvents).where(and(eq(marketingAttributionEvents.workspaceId, row.workspaceId), eq(marketingAttributionEvents.id, row.eventId), lte(marketingAttributionEvents.expiresAt, now)));
      }
      const eventRows = await tx.select({ workspaceId: marketingAttributionEvents.workspaceId, id: marketingAttributionEvents.id }).from(marketingAttributionEvents).where(and(lte(marketingAttributionEvents.expiresAt, now), inArray(marketingAttributionEvents.state, ["cancelled", "failed_known"]))).limit(limit);
      for (const row of eventRows) await tx.delete(marketingAttributionEvents).where(and(eq(marketingAttributionEvents.workspaceId, row.workspaceId), eq(marketingAttributionEvents.id, row.id)));
      const mutationRows = await tx.select({ workspaceId: marketingAttributionMutationReceipts.workspaceId, key: marketingAttributionMutationReceipts.idempotencyKey }).from(marketingAttributionMutationReceipts).where(lte(marketingAttributionMutationReceipts.expiresAt, now)).limit(limit);
      for (const row of mutationRows) await tx.delete(marketingAttributionMutationReceipts).where(and(eq(marketingAttributionMutationReceipts.workspaceId, row.workspaceId), eq(marketingAttributionMutationReceipts.idempotencyKey, row.key)));
      return { receipts: receiptRows.length, events: receiptRows.length + eventRows.length, mutations: mutationRows.length };
    });
  }
}
