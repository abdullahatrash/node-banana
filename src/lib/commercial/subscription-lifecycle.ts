import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { canonicalDigest } from "@/lib/agent-tools/canonical";
import { getDb } from "@/lib/db";
import {
  billingPlanVersions,
  generationCreditBuckets,
  generationCreditLedgerEntries,
  merchantSubscriptionWebhookReceipts,
  workspaceSubscriptionEvents,
  workspaceSubscriptions,
} from "@/lib/db/schema";
import type { MerchantSubscriptionEvent } from "./merchant";

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export class MerchantSubscriptionLifecycleError extends Error {
  constructor(readonly code: string) { super(code); this.name = "MerchantSubscriptionLifecycleError"; }
}

export class MerchantSubscriptionLifecycleService {
  constructor(
    private readonly database: Db = getDb(),
    private readonly now = () => new Date(),
    private readonly graceDays = boundedGraceDays(process.env.MERCHANT_SUBSCRIPTION_GRACE_DAYS),
  ) {}

  async applyVerifiedEvent(event: MerchantSubscriptionEvent) {
    const payloadDigest = canonicalDigest(serializeEvent(event));
    const now = this.now();
    const inserted = await this.database.insert(merchantSubscriptionWebhookReceipts).values({
      provider: event.provider,
      eventId: event.eventId,
      payloadDigest,
      eventType: event.eventType,
      workspaceId: event.workspaceId,
      merchantSubscriptionRef: event.merchantSubscriptionRef,
      merchantTransactionRef: event.merchantTransactionRef,
      state: "received",
      providerOccurredAt: event.occurredAt,
      receivedAt: now,
    }).onConflictDoNothing().returning();
    const [receipt] = inserted[0] ? inserted : await this.database.select().from(merchantSubscriptionWebhookReceipts).where(and(eq(merchantSubscriptionWebhookReceipts.provider, event.provider), eq(merchantSubscriptionWebhookReceipts.eventId, event.eventId))).limit(1);
    if (!receipt || receipt.payloadDigest !== payloadDigest || receipt.workspaceId !== event.workspaceId || receipt.merchantSubscriptionRef !== event.merchantSubscriptionRef) throw new MerchantSubscriptionLifecycleError("SUBSCRIPTION_WEBHOOK_REPLAY_CONFLICT");
    if (receipt.state === "applied" || receipt.state === "ignored") return { state: receipt.state };

    await this.database.update(merchantSubscriptionWebhookReceipts).set({ state: "processing", failureCode: null }).where(and(eq(merchantSubscriptionWebhookReceipts.provider, event.provider), eq(merchantSubscriptionWebhookReceipts.eventId, event.eventId)));
    try {
      return await this.database.transaction(async (tx) => {
        const [current] = await tx.select().from(workspaceSubscriptions).where(eq(workspaceSubscriptions.workspaceId, event.workspaceId)).for("update").limit(1);
        if (!current || current.merchantSubscriptionRef !== event.merchantSubscriptionRef || current.merchantCustomerRef !== event.merchantCustomerRef) throw new MerchantSubscriptionLifecycleError("SUBSCRIPTION_EVENT_NOT_READY");

        const projection = subscriptionLifecycleProjection({
          currentPeriodStartsAt: current.currentPeriodStartsAt,
          currentPeriodEndsAt: current.currentPeriodEndsAt,
          merchantLastEventAt: current.merchantLastEventAt,
          merchantLastEventId: current.merchantLastEventId,
        }, event, this.graceDays);
        let allowanceGranted = false;
        if (event.eventType === "subscription.payment_completed") allowanceGranted = await this.grantPeriodAllowance(tx, current, event);

        if (projection.stale) {
          const state = event.eventType === "subscription.payment_completed" ? "applied" : "ignored";
          await tx.update(merchantSubscriptionWebhookReceipts).set({ state, processedAt: now }).where(and(eq(merchantSubscriptionWebhookReceipts.provider, event.provider), eq(merchantSubscriptionWebhookReceipts.eventId, event.eventId)));
          return { state, stale: true, allowanceGranted };
        }

        const { target, periodStartsAt, periodEndsAt, graceEndsAt } = projection;
        const revision = current.revision + 1;
        const updated = await tx.update(workspaceSubscriptions).set({
          state: target,
          merchantCustomerRef: event.merchantCustomerRef,
          merchantSubscriptionRef: event.merchantSubscriptionRef,
          merchantLastEventAt: event.occurredAt,
          merchantLastEventId: event.eventId,
          currentPeriodStartsAt: periodStartsAt,
          currentPeriodEndsAt: periodEndsAt,
          graceEndsAt,
          revision,
          updatedAt: now,
        }).where(and(eq(workspaceSubscriptions.workspaceId, event.workspaceId), eq(workspaceSubscriptions.revision, current.revision))).returning({ revision: workspaceSubscriptions.revision });
        if (!updated[0]) throw new MerchantSubscriptionLifecycleError("SUBSCRIPTION_REVISION_CONFLICT");
        await tx.insert(workspaceSubscriptionEvents).values({
          workspaceId: event.workspaceId,
          revision,
          id: randomUUID(),
          fromState: current.state,
          toState: target,
          reasonCode: `merchant.${event.eventType}`,
          actorRef: `system:merchant-of-record:${event.provider}`,
          facts: { providerEventId: event.eventId, providerOccurredAt: event.occurredAt.toISOString(), merchantSubscriptionRef: event.merchantSubscriptionRef, merchantTransactionRef: event.merchantTransactionRef, allowanceGranted },
          occurredAt: event.occurredAt,
        });
        await tx.update(merchantSubscriptionWebhookReceipts).set({ state: "applied", processedAt: now }).where(and(eq(merchantSubscriptionWebhookReceipts.provider, event.provider), eq(merchantSubscriptionWebhookReceipts.eventId, event.eventId)));
        return { state: "applied", subscriptionState: target, revision, allowanceGranted };
      });
    } catch (error) {
      await this.database.update(merchantSubscriptionWebhookReceipts).set({ state: "outcome_unknown", failureCode: error instanceof Error ? error.message.slice(0, 200) : "UNKNOWN", processedAt: now }).where(and(eq(merchantSubscriptionWebhookReceipts.provider, event.provider), eq(merchantSubscriptionWebhookReceipts.eventId, event.eventId)));
      throw error;
    }
  }

  private async grantPeriodAllowance(tx: Tx, current: typeof workspaceSubscriptions.$inferSelect, event: MerchantSubscriptionEvent) {
    if (!event.periodStartsAt || !event.periodEndsAt || !event.merchantTransactionRef || event.periodEndsAt <= event.periodStartsAt) throw new MerchantSubscriptionLifecycleError("SUBSCRIPTION_PAYMENT_PERIOD_INVALID");
    const [plan] = await tx.select({ entitlements: billingPlanVersions.entitlements }).from(billingPlanVersions).where(and(eq(billingPlanVersions.planId, current.planId), eq(billingPlanVersions.version, current.planVersion))).limit(1);
    const units = Number(plan?.entitlements.generationCreditsPerPeriod ?? 0);
    if (!Number.isSafeInteger(units) || units < 0) throw new MerchantSubscriptionLifecycleError("PLAN_ALLOWANCE_INVALID");
    if (!units) return false;
    const sourceRef = `subscription:${event.merchantSubscriptionRef}:${event.periodStartsAt.toISOString()}`;
    const bucketId = randomUUID();
    const inserted = await tx.insert(generationCreditBuckets).values({ workspaceId: event.workspaceId, id: bucketId, kind: "allowance", sourceRef, grantedUnits: units, availableUnits: units, expiresAt: event.periodEndsAt, revision: 1, createdAt: this.now(), updatedAt: this.now() }).onConflictDoNothing().returning({ id: generationCreditBuckets.id });
    if (!inserted[0]) return false;
    const sequence = Number((await tx.select({ value: sql<number>`coalesce(max(${generationCreditLedgerEntries.sequence}), 0)` }).from(generationCreditLedgerEntries).where(eq(generationCreditLedgerEntries.workspaceId, event.workspaceId)))[0]?.value ?? 0) + 1;
    await tx.insert(generationCreditLedgerEntries).values({ workspaceId: event.workspaceId, sequence, id: randomUUID(), bucketId, reservationId: null, entryType: "grant", deltaUnits: units, balanceAfterUnits: units, sourceRef, createdAt: this.now() });
    return true;
  }
}

function targetState(eventType: MerchantSubscriptionEvent["eventType"]) {
  if (eventType === "subscription.grace") return "grace";
  if (eventType === "subscription.cancel_at_period_end") return "cancel_at_period_end";
  if (eventType === "subscription.cancelled") return "cancelled";
  if (eventType === "subscription.suspended") return "suspended";
  return "active";
}

export function subscriptionLifecycleProjection(current: { currentPeriodStartsAt: Date; currentPeriodEndsAt: Date; merchantLastEventAt: Date | null; merchantLastEventId: string | null }, event: MerchantSubscriptionEvent, graceDays: number) {
  const stale = current.merchantLastEventAt
    ? event.occurredAt < current.merchantLastEventAt || (event.occurredAt.getTime() === current.merchantLastEventAt.getTime() && event.eventId <= (current.merchantLastEventId ?? ""))
    : false;
  const target = targetState(event.eventType);
  const periodStartsAt = event.periodStartsAt ?? current.currentPeriodStartsAt;
  const periodEndsAt = event.periodEndsAt ?? current.currentPeriodEndsAt;
  if (periodEndsAt <= periodStartsAt) throw new MerchantSubscriptionLifecycleError("SUBSCRIPTION_PERIOD_INVALID");
  const graceEndsAt = target === "grace" ? new Date(Math.max(periodEndsAt.getTime(), event.occurredAt.getTime()) + graceDays * 86_400_000) : null;
  return { stale, target, periodStartsAt, periodEndsAt, graceEndsAt };
}

function boundedGraceDays(value: string | undefined) {
  const parsed = Number(value ?? "7");
  return Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= 30 ? parsed : 7;
}

function serializeEvent(event: MerchantSubscriptionEvent) {
  return { ...event, periodStartsAt: event.periodStartsAt?.toISOString() ?? null, periodEndsAt: event.periodEndsAt?.toISOString() ?? null, occurredAt: event.occurredAt.toISOString() };
}
