import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, lte, or, isNull, gt } from "drizzle-orm";
import { canonicalDigest } from "@/lib/agent-tools/canonical";
import { getDb } from "@/lib/db";
import { billingPlanVersions, channelOnboardingCommercialQuotes, channelOnboardingOrders, generationCreditPackVersions, merchantCheckoutSessions, merchantWebhookReceipts, user } from "@/lib/db/schema";
import type { ChannelOnboardingRepository } from "@/lib/channel-onboarding/repository";
import type { CommercialRepository } from "./repository";
import type { MerchantCheckoutEvent, MerchantCheckoutPurpose, MerchantOfRecordAdapter } from "./merchant";

type Db = ReturnType<typeof getDb>;
type Purpose =
  | { kind: "subscription"; planId: string; planVersion: number }
  | { kind: "credit_pack"; packId: string; packVersion: number }
  | { kind: "channel_onboarding"; orderId: string; expectedRevision: number };
type Snapshot =
  | { kind: "subscription"; planId: string; planVersion: number; billingInterval: string }
  | { kind: "credit_pack"; packId: string; packVersion: number; creditUnits: number }
  | { kind: "channel_onboarding"; orderId: string; orderRevision: number; quoteId: string };
export interface CheckoutAttributionRecorder { record(input: { workspaceId: string; userId: string; email: string; eventName: "purchase"; occurredAt: Date; value: string; currency: string; idempotencyKey: string }): Promise<unknown> }
export function checkoutPurchaseAttribution(input: { workspaceId: string; userId: string; email: string; amountMinor: number; currency: string; occurredAt: Date; provider: string; providerEventId: string }) {
  return { workspaceId: input.workspaceId, userId: input.userId, email: input.email, eventName: "purchase" as const, occurredAt: input.occurredAt, value: (input.amountMinor / 100).toFixed(2), currency: input.currency.toUpperCase(), idempotencyKey: `xads:purchase:${input.provider}:${input.providerEventId}` };
}

export class MerchantCheckoutError extends Error { constructor(readonly code: string) { super(code); this.name = "MerchantCheckoutError"; } }
const purposeKey = (purpose: Purpose, idempotencyKey: string) => `${purpose.kind}:${"planId" in purpose ? `${purpose.planId}:${purpose.planVersion}` : "packId" in purpose ? `${purpose.packId}:${purpose.packVersion}` : purpose.orderId}:${idempotencyKey}`;
export function checkoutRecoveryDelayMs(attempt: number, status: "pending" | "unavailable" | "error") {
  const base = status === "pending" ? 15_000 : 60_000;
  return Math.min(15 * 60_000, base * 2 ** Math.min(Math.max(attempt, 0), 6));
}

export class MerchantCheckoutService {
  constructor(private readonly database: Db, private readonly merchant: MerchantOfRecordAdapter, private readonly commercial: CommercialRepository, private readonly onboarding: ChannelOnboardingRepository, private readonly now = () => new Date(), private readonly attribution?: CheckoutAttributionRecorder) {}

  async create(input: { workspaceId: string; userId: string; purpose: Purpose; idempotencyKey: string; successPath: string; cancelPath: string }) {
    const now = this.now(), purposeRef = purposeKey(input.purpose, input.idempotencyKey);
    let [session] = await this.database.select().from(merchantCheckoutSessions).where(and(eq(merchantCheckoutSessions.workspaceId, input.workspaceId), eq(merchantCheckoutSessions.purposeKind, input.purpose.kind), eq(merchantCheckoutSessions.purposeRef, purposeRef))).limit(1);
    if (!session) {
      const commercial = await this.resolveCommercial(input.workspaceId, input.purpose, now);
      const id = randomUUID(), expiresAt = new Date(now.getTime() + 30 * 60_000);
      const inserted = await this.database.insert(merchantCheckoutSessions).values({ workspaceId: input.workspaceId, id, purposeKind: input.purpose.kind, purposeRef, state: "creating", commercialSnapshot: commercial.snapshot, amountMinor: commercial.amountMinor, taxMinor: commercial.taxMinor, currency: commercial.currency, termsDigest: commercial.termsDigest, createdByUserId: input.userId, createdAt: now, updatedAt: now, expiresAt }).onConflictDoNothing().returning();
      session = inserted[0] ?? (await this.database.select().from(merchantCheckoutSessions).where(and(eq(merchantCheckoutSessions.workspaceId, input.workspaceId), eq(merchantCheckoutSessions.purposeKind, input.purpose.kind), eq(merchantCheckoutSessions.purposeRef, purposeRef))).limit(1))[0];
    }
    if (!session) throw new MerchantCheckoutError("CHECKOUT_NOT_CREATED");
    if (session.state === "completed") return { checkoutId: session.id, state: session.state, url: null, expiresAt: session.expiresAt.toISOString() };
    if (!inArrayValue(session.state, ["creating", "outcome_unknown"])) throw new MerchantCheckoutError("CHECKOUT_NOT_RETRYABLE");
    if (session.state === "outcome_unknown") {
      const recovered = await this.merchant.recoverCheckout({ checkoutId: session.id, merchantCheckoutRef: session.merchantCheckoutRef });
      if (recovered.kind === "terminal") {
        await this.applyVerifiedEvent(recovered.event);
        const terminalState = recovered.event.eventType === "checkout.completed" ? "completed" : recovered.event.eventType === "checkout.failed" ? "failed_known" : recovered.event.eventType === "checkout.expired" ? "expired" : "cancelled";
        return { checkoutId: session.id, state: terminalState, url: null, expiresAt: session.expiresAt.toISOString() };
      }
      if (recovered.kind === "ready") {
        if (recovered.expiresAt <= this.now() || recovered.expiresAt.getTime() - this.now().getTime() > 86_400_000) throw new MerchantCheckoutError("CHECKOUT_EXPIRY_INVALID");
        await this.database.update(merchantCheckoutSessions).set({ state: "ready", merchantCheckoutRef: recovered.merchantCheckoutRef, expiresAt: recovered.expiresAt, recoveryAttempts: 0, nextRecoveryAt: new Date(this.now().getTime() + 15_000), lastRecoveryStatus: "recovered_ready", updatedAt: this.now() }).where(and(eq(merchantCheckoutSessions.workspaceId, input.workspaceId), eq(merchantCheckoutSessions.id, session.id), eq(merchantCheckoutSessions.state, "outcome_unknown")));
        return { checkoutId: session.id, state: "ready", url: recovered.url, expiresAt: recovered.expiresAt.toISOString() };
      }
      throw new MerchantCheckoutError("CHECKOUT_OUTCOME_UNKNOWN");
    }
    try {
      const result = await this.merchant.createCheckout({ checkoutId: session.id, workspaceId: input.workspaceId, purposeKind: session.purposeKind as MerchantCheckoutPurpose, purposeRef: session.purposeRef, amountMinor: session.amountMinor, taxMinor: session.taxMinor, currency: session.currency, termsDigest: session.termsDigest, commercialSnapshot: session.commercialSnapshot, successPath: input.successPath, cancelPath: input.cancelPath });
      if (result.kind === "unavailable") { await this.database.update(merchantCheckoutSessions).set({ state: "failed_known", updatedAt: this.now() }).where(and(eq(merchantCheckoutSessions.workspaceId, input.workspaceId), eq(merchantCheckoutSessions.id, session.id), inArray(merchantCheckoutSessions.state, ["creating", "outcome_unknown"]))); throw new MerchantCheckoutError("MERCHANT_OF_RECORD_UNAVAILABLE"); }
      if (result.expiresAt <= this.now() || result.expiresAt.getTime() - this.now().getTime() > 86_400_000) throw new MerchantCheckoutError("CHECKOUT_EXPIRY_INVALID");
      const readyAt = this.now();
      await this.database.update(merchantCheckoutSessions).set({ state: "ready", merchantCheckoutRef: result.merchantCheckoutRef, expiresAt: result.expiresAt, recoveryAttempts: 0, nextRecoveryAt: new Date(readyAt.getTime() + 15_000), lastRecoveryStatus: "created", updatedAt: readyAt }).where(and(eq(merchantCheckoutSessions.workspaceId, input.workspaceId), eq(merchantCheckoutSessions.id, session.id), inArray(merchantCheckoutSessions.state, ["creating", "outcome_unknown"])));
      return { checkoutId: session.id, state: "ready", url: result.url, expiresAt: result.expiresAt.toISOString() };
    } catch (error) {
      const failedAt = this.now();
      await this.database.update(merchantCheckoutSessions).set({ state: "outcome_unknown", nextRecoveryAt: new Date(failedAt.getTime() + 60_000), lastRecoveryStatus: "create_transport_lost", updatedAt: failedAt }).where(and(eq(merchantCheckoutSessions.workspaceId, input.workspaceId), eq(merchantCheckoutSessions.id, session.id), inArray(merchantCheckoutSessions.state, ["creating", "outcome_unknown"])));
      throw error;
    }
  }

  async applyVerifiedEvent(event: MerchantCheckoutEvent) {
    const payloadDigest = canonicalDigest(serializeEvent(event)), now = this.now();
    const inserted = await this.database.insert(merchantWebhookReceipts).values({ provider: event.provider, eventId: event.eventId, payloadDigest, eventType: event.eventType, checkoutId: event.checkoutId, merchantEffectRef: event.merchantEffectRef, state: "received", providerOccurredAt: event.occurredAt, receivedAt: now }).onConflictDoNothing().returning();
    const [receipt] = inserted[0] ? inserted : await this.database.select().from(merchantWebhookReceipts).where(and(eq(merchantWebhookReceipts.provider, event.provider), eq(merchantWebhookReceipts.eventId, event.eventId))).limit(1);
    if (!receipt || receipt.payloadDigest !== payloadDigest || receipt.checkoutId !== event.checkoutId || receipt.merchantEffectRef !== event.merchantEffectRef) throw new MerchantCheckoutError("WEBHOOK_REPLAY_CONFLICT");
    if (receipt.state === "applied" || receipt.state === "ignored") return { state: receipt.state };
    const [checkout] = await this.database.select().from(merchantCheckoutSessions).where(eq(merchantCheckoutSessions.id, event.checkoutId)).limit(1);
    if (!checkout || (checkout.merchantCheckoutRef && checkout.merchantCheckoutRef !== event.merchantCheckoutRef)) throw new MerchantCheckoutError("CHECKOUT_EVENT_MISMATCH");
    await this.database.update(merchantWebhookReceipts).set({ state: "processing" }).where(and(eq(merchantWebhookReceipts.provider, event.provider), eq(merchantWebhookReceipts.eventId, event.eventId)));
    const state = event.eventType === "checkout.failed" ? "failed_known" : event.eventType === "checkout.expired" ? "expired" : event.eventType === "checkout.cancelled" ? "cancelled" : "completed";
    try {
      if (state === "completed") await this.applyCompletion(checkout.workspaceId, checkout.commercialSnapshot as Snapshot, event);
      await this.database.update(merchantCheckoutSessions).set({ state, merchantCheckoutRef: event.merchantCheckoutRef, merchantEffectRef: event.merchantEffectRef, merchantCustomerRef: event.merchantCustomerRef, recoveryLeaseOwner: null, recoveryLeaseExpiresAt: null, lastRecoveryStatus: `terminal:${state}`, completedAt: state === "completed" ? now : null, updatedAt: now }).where(and(eq(merchantCheckoutSessions.workspaceId, checkout.workspaceId), eq(merchantCheckoutSessions.id, checkout.id), inArray(merchantCheckoutSessions.state, ["creating", "ready", "outcome_unknown"])));
      await this.database.update(merchantWebhookReceipts).set({ state: "applied", processedAt: now }).where(and(eq(merchantWebhookReceipts.provider, event.provider), eq(merchantWebhookReceipts.eventId, event.eventId)));
      if (state === "completed" && this.attribution) {
        try {
          const [identity] = await this.database.select({ email: user.email }).from(user).where(eq(user.id, checkout.createdByUserId)).limit(1);
          if (identity) await this.attribution.record(checkoutPurchaseAttribution({ workspaceId: checkout.workspaceId, userId: checkout.createdByUserId, email: identity.email, amountMinor: checkout.amountMinor, currency: checkout.currency, occurredAt: event.occurredAt, provider: event.provider, providerEventId: event.eventId }));
        } catch { /* Attribution must never change a signed commercial outcome. */ }
      }
      return { state: "applied" };
    } catch (error) {
      await this.database.update(merchantCheckoutSessions).set({ state: "outcome_unknown", recoveryLeaseOwner: null, recoveryLeaseExpiresAt: null, nextRecoveryAt: new Date(now.getTime() + 60_000), lastRecoveryStatus: "event_application_failed", updatedAt: now }).where(and(eq(merchantCheckoutSessions.workspaceId, checkout.workspaceId), eq(merchantCheckoutSessions.id, checkout.id)));
      await this.database.update(merchantWebhookReceipts).set({ state: "outcome_unknown", failureCode: error instanceof Error ? error.message.slice(0, 200) : "UNKNOWN", processedAt: now }).where(and(eq(merchantWebhookReceipts.provider, event.provider), eq(merchantWebhookReceipts.eventId, event.eventId)));
      throw error;
    }
  }

  async reconcile(limit = 20) {
    const at = this.now(), owner = randomUUID(), leaseExpiresAt = new Date(at.getTime() + 50_000), boundedLimit = Math.min(Math.max(limit, 1), 20);
    const sessions = await this.database.transaction(async (tx) => {
      const rows = await tx.select().from(merchantCheckoutSessions).where(and(inArray(merchantCheckoutSessions.state, ["creating", "ready", "outcome_unknown"]), lte(merchantCheckoutSessions.nextRecoveryAt, at), or(isNull(merchantCheckoutSessions.recoveryLeaseExpiresAt), lte(merchantCheckoutSessions.recoveryLeaseExpiresAt, at)))).orderBy(asc(merchantCheckoutSessions.nextRecoveryAt), asc(merchantCheckoutSessions.id)).limit(boundedLimit).for("update", { skipLocked: true });
      for (const row of rows) await tx.update(merchantCheckoutSessions).set({ recoveryLeaseOwner: owner, recoveryLeaseExpiresAt: leaseExpiresAt, updatedAt: at }).where(and(eq(merchantCheckoutSessions.workspaceId, row.workspaceId), eq(merchantCheckoutSessions.id, row.id)));
      return rows;
    });
    const summary = { inspected: sessions.length, applied: 0, recovered: 0, pending: 0, unavailable: 0, failed: 0 };
    for (const session of sessions) {
      try {
        const result = await this.merchant.recoverCheckout({ checkoutId: session.id, merchantCheckoutRef: session.merchantCheckoutRef });
        if (result.kind === "terminal") {
          if (result.event.checkoutId !== session.id || (session.merchantCheckoutRef && result.event.merchantCheckoutRef !== session.merchantCheckoutRef)) throw new MerchantCheckoutError("CHECKOUT_EVENT_MISMATCH");
          await this.applyVerifiedEvent(result.event); summary.applied += 1; continue;
        }
        if (result.kind === "ready") {
          if (result.expiresAt <= at || result.expiresAt.getTime() - at.getTime() > 86_400_000) throw new MerchantCheckoutError("CHECKOUT_EXPIRY_INVALID");
          await this.database.update(merchantCheckoutSessions).set({ state: "ready", merchantCheckoutRef: result.merchantCheckoutRef, expiresAt: result.expiresAt, recoveryAttempts: 0, nextRecoveryAt: new Date(at.getTime() + 15_000), recoveryLeaseOwner: null, recoveryLeaseExpiresAt: null, lastRecoveryStatus: "recovered_ready", updatedAt: at }).where(and(eq(merchantCheckoutSessions.workspaceId, session.workspaceId), eq(merchantCheckoutSessions.id, session.id), eq(merchantCheckoutSessions.recoveryLeaseOwner, owner)));
          summary.recovered += 1; continue;
        }
        const status = result.kind;
        summary[status] += 1;
        const attempt = session.recoveryAttempts + 1;
        await this.database.update(merchantCheckoutSessions).set({ recoveryAttempts: attempt, nextRecoveryAt: new Date(at.getTime() + checkoutRecoveryDelayMs(attempt, status)), recoveryLeaseOwner: null, recoveryLeaseExpiresAt: null, lastRecoveryStatus: status, updatedAt: at }).where(and(eq(merchantCheckoutSessions.workspaceId, session.workspaceId), eq(merchantCheckoutSessions.id, session.id), eq(merchantCheckoutSessions.recoveryLeaseOwner, owner)));
      } catch {
        summary.failed += 1;
        const attempt = session.recoveryAttempts + 1;
        await this.database.update(merchantCheckoutSessions).set({ state: "outcome_unknown", recoveryAttempts: attempt, nextRecoveryAt: new Date(at.getTime() + checkoutRecoveryDelayMs(attempt, "error")), recoveryLeaseOwner: null, recoveryLeaseExpiresAt: null, lastRecoveryStatus: "recovery_error", updatedAt: at }).where(and(eq(merchantCheckoutSessions.workspaceId, session.workspaceId), eq(merchantCheckoutSessions.id, session.id), eq(merchantCheckoutSessions.recoveryLeaseOwner, owner)));
      }
    }
    return summary;
  }

  private async resolveCommercial(workspaceId: string, purpose: Purpose, now: Date) {
    if (purpose.kind === "subscription") { const [plan] = await this.database.select().from(billingPlanVersions).where(and(eq(billingPlanVersions.planId, purpose.planId), eq(billingPlanVersions.version, purpose.planVersion), eq(billingPlanVersions.status, "active"), lte(billingPlanVersions.effectiveAt, now), or(isNull(billingPlanVersions.retiredAt), gt(billingPlanVersions.retiredAt, now)))).limit(1); if (!plan || plan.billingInterval === "one_time" || plan.taxMode !== "inclusive" || plan.priceMinor <= 0) throw new MerchantCheckoutError("PLAN_NOT_PURCHASABLE"); return { snapshot: { kind: purpose.kind, planId: plan.planId, planVersion: plan.version, billingInterval: plan.billingInterval }, amountMinor: plan.priceMinor, taxMinor: 0, currency: plan.currency, termsDigest: plan.termsDigest }; }
    if (purpose.kind === "credit_pack") { const [pack] = await this.database.select().from(generationCreditPackVersions).where(and(eq(generationCreditPackVersions.packId, purpose.packId), eq(generationCreditPackVersions.version, purpose.packVersion), eq(generationCreditPackVersions.status, "active"), lte(generationCreditPackVersions.effectiveAt, now), or(isNull(generationCreditPackVersions.retiredAt), gt(generationCreditPackVersions.retiredAt, now)))).limit(1); if (!pack) throw new MerchantCheckoutError("CREDIT_PACK_NOT_PURCHASABLE"); return { snapshot: { kind: purpose.kind, packId: pack.packId, packVersion: pack.version, creditUnits: pack.creditUnits }, amountMinor: pack.priceMinor, taxMinor: pack.taxMinor, currency: pack.currency, termsDigest: pack.termsDigest }; }
    const rows = await this.database.select({ order: channelOnboardingOrders, quote: channelOnboardingCommercialQuotes }).from(channelOnboardingOrders).innerJoin(channelOnboardingCommercialQuotes, and(eq(channelOnboardingCommercialQuotes.workspaceId, channelOnboardingOrders.workspaceId), eq(channelOnboardingCommercialQuotes.id, channelOnboardingOrders.quoteId))).where(and(eq(channelOnboardingOrders.workspaceId, workspaceId), eq(channelOnboardingOrders.id, purpose.orderId), eq(channelOnboardingOrders.revision, purpose.expectedRevision), eq(channelOnboardingOrders.state, "payment_pending"), eq(channelOnboardingCommercialQuotes.state, "payment_pending"), gt(channelOnboardingCommercialQuotes.expiresAt, now))).limit(1); const row = rows[0]; if (!row) throw new MerchantCheckoutError("ONBOARDING_QUOTE_NOT_PAYABLE"); return { snapshot: { kind: purpose.kind, orderId: row.order.id, orderRevision: row.order.revision, quoteId: row.quote.id }, amountMinor: row.quote.subtotalMinor, taxMinor: row.quote.taxMinor, currency: row.quote.currency, termsDigest: row.quote.termsDigest };
  }

  private async applyCompletion(workspaceId: string, snapshot: Snapshot, event: MerchantCheckoutEvent) {
    const key = `merchant:${event.provider}:${event.eventId}`;
    if (snapshot.kind === "subscription") { if (!event.merchantCustomerRef || !event.merchantSubscriptionRef || !event.periodStartsAt || !event.periodEndsAt) throw new MerchantCheckoutError("SUBSCRIPTION_EFFECT_INCOMPLETE"); return this.commercial.activatePaidSubscription({ workspaceId, planId: snapshot.planId, planVersion: snapshot.planVersion, periodStartsAt: event.periodStartsAt, periodEndsAt: event.periodEndsAt, merchantCustomerRef: event.merchantCustomerRef, merchantSubscriptionRef: event.merchantSubscriptionRef, idempotencyKey: key }); }
    if (snapshot.kind === "credit_pack") { if (!event.merchantReceiptRef) throw new MerchantCheckoutError("CREDIT_EFFECT_INCOMPLETE"); return this.commercial.grantPurchasedCredits({ workspaceId, merchantReceiptRef: event.merchantReceiptRef, units: snapshot.creditUnits, idempotencyKey: key }); }
    if (!event.merchantReceiptRef) throw new MerchantCheckoutError("ONBOARDING_EFFECT_INCOMPLETE"); return this.onboarding.confirmPayment({ workspaceId, orderId: snapshot.orderId, expectedRevision: snapshot.orderRevision, merchantReceiptRef: event.merchantReceiptRef, idempotencyKey: key });
  }
}

function inArrayValue<T extends string>(value: string, values: readonly T[]): value is T { return values.includes(value as T); }
function serializeEvent(event: MerchantCheckoutEvent) { return { ...event, periodStartsAt: event.periodStartsAt?.toISOString() ?? null, periodEndsAt: event.periodEndsAt?.toISOString() ?? null, occurredAt: event.occurredAt.toISOString() }; }
