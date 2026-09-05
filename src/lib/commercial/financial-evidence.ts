import "server-only";
import { randomUUID } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { generationCreditBuckets, generationCreditLedgerEntries, merchantBillingAdjustmentEvents, merchantBillingAdjustments, merchantBillingTransactions, merchantCheckoutSessions, merchantCreditLiabilities, merchantExecutionHolds, workspaceSubscriptions } from "@/lib/db/schema";
import type { MerchantAdjustmentEvent, MerchantCheckoutEvent, MerchantSubscriptionEvent } from "./merchant";

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export class MerchantFinancialEvidenceError extends Error {
  constructor(readonly code: string) { super(code); this.name = "MerchantFinancialEvidenceError"; }
}

export class MerchantFinancialEvidenceService {
  constructor(private readonly database: Db = getDb(), private readonly now = () => new Date()) {}

  async recordCheckout(event: MerchantCheckoutEvent) {
    if (!event.billingTransaction) return { state: "ignored" as const };
    const [checkout] = await this.database.select().from(merchantCheckoutSessions).where(eq(merchantCheckoutSessions.id, event.checkoutId)).limit(1);
    if (!checkout || checkout.merchantCheckoutRef !== event.billingTransaction.transactionRef || !event.merchantCustomerRef || !event.merchantReceiptRef) throw new MerchantFinancialEvidenceError("BILLING_TRANSACTION_CHECKOUT_MISMATCH");
    return this.recordTransaction({
      provider: event.provider,
      transactionRef: event.billingTransaction.transactionRef,
      workspaceId: checkout.workspaceId,
      checkoutId: checkout.id,
      purposeKind: checkout.purposeKind,
      merchantCustomerRef: event.merchantCustomerRef,
      merchantSubscriptionRef: event.merchantSubscriptionRef,
      merchantReceiptRef: event.merchantReceiptRef,
      amountMinor: event.billingTransaction.amountMinor,
      currency: event.billingTransaction.currency,
      invoiceNumber: event.billingTransaction.invoiceNumber,
      periodStartsAt: event.periodStartsAt,
      periodEndsAt: event.periodEndsAt,
      providerOccurredAt: event.occurredAt,
    });
  }

  async recordSubscription(event: MerchantSubscriptionEvent) {
    if (!event.billingTransaction || event.eventType !== "subscription.payment_completed") return { state: "ignored" as const };
    return this.recordTransaction({
      provider: event.provider,
      transactionRef: event.billingTransaction.transactionRef,
      workspaceId: event.workspaceId,
      checkoutId: null,
      purposeKind: "subscription_renewal",
      merchantCustomerRef: event.merchantCustomerRef,
      merchantSubscriptionRef: event.merchantSubscriptionRef,
      merchantReceiptRef: event.billingTransaction.invoiceNumber ?? event.billingTransaction.transactionRef,
      amountMinor: event.billingTransaction.amountMinor,
      currency: event.billingTransaction.currency,
      invoiceNumber: event.billingTransaction.invoiceNumber,
      periodStartsAt: event.periodStartsAt,
      periodEndsAt: event.periodEndsAt,
      providerOccurredAt: event.occurredAt,
    });
  }

  async applyAdjustment(event: MerchantAdjustmentEvent) {
    return this.database.transaction(async (tx) => {
      const [transaction] = await tx.select().from(merchantBillingTransactions).where(and(eq(merchantBillingTransactions.provider, event.provider), eq(merchantBillingTransactions.transactionRef, event.transactionRef))).for("update").limit(1);
      if (!transaction) throw new MerchantFinancialEvidenceError("ADJUSTMENT_TRANSACTION_NOT_READY");
      if (transaction.currency !== event.currency || transaction.merchantCustomerRef !== event.merchantCustomerRef || (event.merchantSubscriptionRef && transaction.merchantSubscriptionRef !== event.merchantSubscriptionRef)) throw new MerchantFinancialEvidenceError("ADJUSTMENT_TRANSACTION_MISMATCH");
      if (isSubscriptionTransaction(transaction)) {
        if (!transaction.merchantSubscriptionRef || !transaction.periodStartsAt || !transaction.periodEndsAt) throw new MerchantFinancialEvidenceError("ADJUSTMENT_SUBSCRIPTION_PERIOD_NOT_READY");
        await tx.select({ workspaceId: workspaceSubscriptions.workspaceId }).from(workspaceSubscriptions).where(eq(workspaceSubscriptions.workspaceId, transaction.workspaceId)).for("update").limit(1);
      }
      const eventRecord = { provider: event.provider, eventId: event.eventId, adjustmentRef: event.adjustmentRef, workspaceId: transaction.workspaceId, transactionRef: event.transactionRef, merchantSubscriptionRef: event.merchantSubscriptionRef, merchantCustomerRef: event.merchantCustomerRef, action: event.action, status: event.status, amountMinor: event.amountMinor, currency: event.currency, reason: event.reason, providerOccurredAt: event.occurredAt, receivedAt: this.now() };
      const insertedEvent = await tx.insert(merchantBillingAdjustmentEvents).values(eventRecord).onConflictDoNothing().returning();
      if (!insertedEvent[0]) {
        const [sameEvent] = await tx.select().from(merchantBillingAdjustmentEvents).where(and(eq(merchantBillingAdjustmentEvents.provider, event.provider), eq(merchantBillingAdjustmentEvents.eventId, event.eventId))).limit(1);
        if (!sameEvent || !sameAdjustmentEvent(sameEvent, eventRecord)) throw new MerchantFinancialEvidenceError("ADJUSTMENT_WEBHOOK_REPLAY_CONFLICT");
        return { state: "applied" as const, transactionStatus: transaction.status };
      }
      const [currentAdjustment] = await tx.select().from(merchantBillingAdjustments).where(and(eq(merchantBillingAdjustments.provider, event.provider), eq(merchantBillingAdjustments.adjustmentRef, event.adjustmentRef))).for("update").limit(1);
      if (currentAdjustment && event.occurredAt <= currentAdjustment.providerOccurredAt) return { state: "ignored" as const, transactionStatus: transaction.status };
      if (currentAdjustment) {
        await tx.update(merchantBillingAdjustments).set({ eventId: event.eventId, status: event.status, amountMinor: event.amountMinor, reason: event.reason, providerOccurredAt: event.occurredAt, updatedAt: this.now() }).where(and(eq(merchantBillingAdjustments.provider, event.provider), eq(merchantBillingAdjustments.adjustmentRef, event.adjustmentRef)));
      } else {
        await tx.insert(merchantBillingAdjustments).values({ provider: event.provider, adjustmentRef: event.adjustmentRef, eventId: event.eventId, workspaceId: transaction.workspaceId, transactionRef: event.transactionRef, merchantSubscriptionRef: event.merchantSubscriptionRef, merchantCustomerRef: event.merchantCustomerRef, action: event.action, status: event.status, amountMinor: event.amountMinor, currency: event.currency, reason: event.reason, providerOccurredAt: event.occurredAt, updatedAt: this.now() });
      }
      const adjustments = await tx.select().from(merchantBillingAdjustments).where(and(eq(merchantBillingAdjustments.provider, event.provider), eq(merchantBillingAdjustments.transactionRef, event.transactionRef))).orderBy(desc(merchantBillingAdjustments.providerOccurredAt));
      const { refundedMinor, status } = financialStateFromAdjustments(transaction.amountMinor, adjustments);
      await tx.update(merchantBillingTransactions).set({ refundedMinor, status, updatedAt: this.now() }).where(and(eq(merchantBillingTransactions.provider, event.provider), eq(merchantBillingTransactions.transactionRef, event.transactionRef)));
      const creditEffect = await this.applyGenerationCreditAdjustment(tx, transaction, { refundedMinor, status }, event);
      const executionHold = await this.applySubscriptionExecutionHold(tx, transaction, { refundedMinor, status });
      return { state: "applied" as const, transactionStatus: status, refundedMinor, creditEffect, executionHold };
    });
  }

  private async applyGenerationCreditAdjustment(tx: Tx, transaction: typeof merchantBillingTransactions.$inferSelect, projection: { refundedMinor: number; status: string }, event: MerchantAdjustmentEvent) {
    const bucketIdentity = generationCreditBucketIdentity(transaction);
    if (!bucketIdentity) return null;
    const [current] = await tx.select().from(merchantCreditLiabilities).where(and(eq(merchantCreditLiabilities.provider, transaction.provider), eq(merchantCreditLiabilities.transactionRef, transaction.transactionRef))).for("update").limit(1);
    const [bucket] = await tx.select().from(generationCreditBuckets).where(and(eq(generationCreditBuckets.workspaceId, transaction.workspaceId), eq(generationCreditBuckets.kind, bucketIdentity.kind), eq(generationCreditBuckets.sourceRef, bucketIdentity.sourceRef))).for("update").limit(1);
    if (!bucket) throw new MerchantFinancialEvidenceError("ADJUSTMENT_CREDIT_BUCKET_NOT_READY");
    const target = creditClawbackTarget({ grantedUnits: bucket.grantedUnits, amountMinor: transaction.amountMinor, refundedMinor: projection.refundedMinor, transactionStatus: projection.status });
    const previousTarget = current?.targetClawbackUnits ?? 0;
    if (target === previousTarget) return { targetUnits: target, appliedUnits: current?.appliedClawbackUnits ?? 0, outstandingUnits: current?.outstandingUnits ?? 0 };

    const reconciled = reconcileCreditClawback({ previousTarget, target, appliedUnits: current?.appliedClawbackUnits ?? 0, outstandingUnits: current?.outstandingUnits ?? 0, availableUnits: bucket.availableUnits, grantedUnits: bucket.grantedUnits });
    const { appliedUnits: applied, outstandingUnits: outstanding, availableUnits: available, ledgerDelta } = reconciled;
    const at = this.now();
    if (ledgerDelta !== 0) {
      await tx.update(generationCreditBuckets).set({ availableUnits: available, revision: sql`${generationCreditBuckets.revision}+1`, updatedAt: at }).where(and(eq(generationCreditBuckets.workspaceId, bucket.workspaceId), eq(generationCreditBuckets.id, bucket.id), eq(generationCreditBuckets.revision, bucket.revision)));
      const sequence = await nextCreditSequence(tx, bucket.workspaceId);
      await tx.insert(generationCreditLedgerEntries).values({ workspaceId: bucket.workspaceId, sequence, id: randomUUID(), bucketId: bucket.id, reservationId: null, entryType: ledgerDelta < 0 ? "clawback" : "clawback_reverse", deltaUnits: ledgerDelta, balanceAfterUnits: available, sourceRef: `merchant-adjustment:${event.provider}:${event.eventId}`, createdAt: at });
    }
    const values = { workspaceId: transaction.workspaceId, bucketId: bucket.id, targetClawbackUnits: target, appliedClawbackUnits: applied, outstandingUnits: outstanding, state: outstanding > 0 ? "open" : "clear", updatedAt: at };
    if (current) await tx.update(merchantCreditLiabilities).set(values).where(and(eq(merchantCreditLiabilities.provider, transaction.provider), eq(merchantCreditLiabilities.transactionRef, transaction.transactionRef)));
    else await tx.insert(merchantCreditLiabilities).values({ provider: transaction.provider, transactionRef: transaction.transactionRef, ...values });
    return { targetUnits: target, appliedUnits: applied, outstandingUnits: outstanding };
  }

  private async applySubscriptionExecutionHold(tx: Tx, transaction: typeof merchantBillingTransactions.$inferSelect, projection: { refundedMinor: number; status: string }) {
    if (!isSubscriptionTransaction(transaction)) return null;
    if (!transaction.merchantSubscriptionRef || !transaction.periodStartsAt || !transaction.periodEndsAt) throw new MerchantFinancialEvidenceError("ADJUSTMENT_SUBSCRIPTION_PERIOD_NOT_READY");
    const state = subscriptionFinancialHoldState({ transactionStatus: projection.status, amountMinor: transaction.amountMinor, refundedMinor: projection.refundedMinor });
    const reason = projection.status === "disputed" ? "disputed" : "refunded";
    const values = { workspaceId: transaction.workspaceId, merchantSubscriptionRef: transaction.merchantSubscriptionRef, periodStartsAt: transaction.periodStartsAt, periodEndsAt: transaction.periodEndsAt, reason, state, updatedAt: this.now() };
    const [current] = await tx.select().from(merchantExecutionHolds).where(and(eq(merchantExecutionHolds.provider, transaction.provider), eq(merchantExecutionHolds.transactionRef, transaction.transactionRef))).for("update").limit(1);
    if (current) await tx.update(merchantExecutionHolds).set(values).where(and(eq(merchantExecutionHolds.provider, transaction.provider), eq(merchantExecutionHolds.transactionRef, transaction.transactionRef)));
    else await tx.insert(merchantExecutionHolds).values({ provider: transaction.provider, transactionRef: transaction.transactionRef, ...values });
    return { state, reason };
  }

  private async recordTransaction(input: Omit<typeof merchantBillingTransactions.$inferInsert, "refundedMinor" | "status" | "updatedAt">) {
    const inserted = await this.database.insert(merchantBillingTransactions).values({ ...input, refundedMinor: 0, status: "completed", updatedAt: this.now() }).onConflictDoNothing().returning();
    if (inserted[0]) return { state: "recorded" as const };
    const [current] = await this.database.select().from(merchantBillingTransactions).where(and(eq(merchantBillingTransactions.provider, input.provider), eq(merchantBillingTransactions.transactionRef, input.transactionRef))).limit(1);
    if (!current || current.workspaceId !== input.workspaceId || current.checkoutId !== input.checkoutId || current.purposeKind !== input.purposeKind || current.merchantReceiptRef !== input.merchantReceiptRef || current.amountMinor !== input.amountMinor || current.currency !== input.currency || current.merchantCustomerRef !== input.merchantCustomerRef || current.merchantSubscriptionRef !== input.merchantSubscriptionRef || !sameOptionalDate(current.periodStartsAt, input.periodStartsAt) || !sameOptionalDate(current.periodEndsAt, input.periodEndsAt)) throw new MerchantFinancialEvidenceError("BILLING_TRANSACTION_REPLAY_CONFLICT");
    return { state: "recorded" as const };
  }
}

async function nextCreditSequence(tx: Tx, workspaceId: string) {
  return Number((await tx.select({ value: sql<number>`coalesce(max(${generationCreditLedgerEntries.sequence}), 0)` }).from(generationCreditLedgerEntries).where(eq(generationCreditLedgerEntries.workspaceId, workspaceId)))[0]?.value ?? 0) + 1;
}

function sameAdjustmentEvent(left: typeof merchantBillingAdjustmentEvents.$inferSelect, right: typeof merchantBillingAdjustmentEvents.$inferInsert) {
  return left.adjustmentRef === right.adjustmentRef && left.workspaceId === right.workspaceId && left.transactionRef === right.transactionRef && left.merchantSubscriptionRef === right.merchantSubscriptionRef && left.merchantCustomerRef === right.merchantCustomerRef && left.action === right.action && left.status === right.status && left.amountMinor === right.amountMinor && left.currency === right.currency && left.reason === right.reason && left.providerOccurredAt.getTime() === right.providerOccurredAt.getTime();
}

export function financialStateFromAdjustments(amountMinor: number, adjustments: Array<{ action: string; status: string; amountMinor: number; providerOccurredAt: Date }>) {
  const approved = adjustments.filter((item) => item.status === "approved");
  const refunded = approved.filter((item) => item.action === "refund" || item.action === "credit").reduce((sum, item) => sum + item.amountMinor, 0);
  const creditReversed = approved.filter((item) => item.action === "credit_reverse").reduce((sum, item) => sum + item.amountMinor, 0);
  const refundedMinor = Math.max(0, refunded - creditReversed);
  if (refundedMinor > amountMinor) throw new MerchantFinancialEvidenceError("ADJUSTMENT_TOTAL_EXCEEDS_TRANSACTION");
  const latestDispute = approved.filter((item) => ["chargeback", "chargeback_warning", "chargeback_reverse", "chargeback_warning_reverse"].includes(item.action)).sort((a, b) => b.providerOccurredAt.getTime() - a.providerOccurredAt.getTime())[0];
  const status = latestDispute && ["chargeback", "chargeback_warning"].includes(latestDispute.action) ? "disputed" : latestDispute ? "chargeback_reversed" : refundedMinor === amountMinor && refundedMinor > 0 ? "refunded" : refundedMinor > 0 ? "partially_refunded" : "completed";
  return { refundedMinor, status };
}

export function creditPackClawbackTarget(input: { grantedUnits: number; amountMinor: number; refundedMinor: number; transactionStatus: string }) {
  return creditClawbackTarget(input);
}

export function creditClawbackTarget(input: { grantedUnits: number; amountMinor: number; refundedMinor: number; transactionStatus: string }) {
  if (!Number.isSafeInteger(input.grantedUnits) || input.grantedUnits < 0 || !Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0 || !Number.isSafeInteger(input.refundedMinor) || input.refundedMinor < 0 || input.refundedMinor > input.amountMinor) throw new MerchantFinancialEvidenceError("CREDIT_CLAWBACK_INPUT_INVALID");
  if (input.transactionStatus === "disputed") return input.grantedUnits;
  if (input.refundedMinor === input.amountMinor) return input.grantedUnits;
  return Number((BigInt(input.grantedUnits) * BigInt(input.refundedMinor)) / BigInt(input.amountMinor));
}

export function subscriptionFinancialHoldState(input: { transactionStatus: string; amountMinor: number; refundedMinor: number }): "active" | "released" {
  if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0 || !Number.isSafeInteger(input.refundedMinor) || input.refundedMinor < 0 || input.refundedMinor > input.amountMinor) throw new MerchantFinancialEvidenceError("SUBSCRIPTION_FINANCIAL_HOLD_INPUT_INVALID");
  return input.transactionStatus === "disputed" || input.refundedMinor === input.amountMinor ? "active" : "released";
}

function isSubscriptionTransaction(transaction: Pick<typeof merchantBillingTransactions.$inferSelect, "purposeKind">) {
  return transaction.purposeKind === "subscription" || transaction.purposeKind === "subscription_renewal";
}

function generationCreditBucketIdentity(transaction: Pick<typeof merchantBillingTransactions.$inferSelect, "purposeKind" | "merchantReceiptRef" | "merchantSubscriptionRef" | "periodStartsAt">) {
  if (transaction.purposeKind === "credit_pack") return { kind: "purchased" as const, sourceRef: `merchant:${transaction.merchantReceiptRef}` };
  if (!isSubscriptionTransaction(transaction)) return null;
  if (!transaction.merchantSubscriptionRef || !transaction.periodStartsAt) throw new MerchantFinancialEvidenceError("ADJUSTMENT_SUBSCRIPTION_PERIOD_NOT_READY");
  return { kind: "allowance" as const, sourceRef: `subscription:${transaction.merchantSubscriptionRef}:${transaction.periodStartsAt.toISOString()}` };
}

function sameOptionalDate(left: Date | null, right: Date | null | undefined) {
  return left === null ? right == null : right instanceof Date && left.getTime() === right.getTime();
}

export function reconcileCreditClawback(input: { previousTarget: number; target: number; appliedUnits: number; outstandingUnits: number; availableUnits: number; grantedUnits: number }) {
  for (const value of Object.values(input)) if (!Number.isSafeInteger(value) || value < 0) throw new MerchantFinancialEvidenceError("CREDIT_CLAWBACK_INVARIANT_FAILED");
  if (input.appliedUnits + input.outstandingUnits !== input.previousTarget || input.previousTarget > input.grantedUnits || input.target > input.grantedUnits || input.availableUnits > input.grantedUnits) throw new MerchantFinancialEvidenceError("CREDIT_CLAWBACK_INVARIANT_FAILED");
  let appliedUnits = input.appliedUnits, outstandingUnits = input.outstandingUnits, availableUnits = input.availableUnits, ledgerDelta = 0;
  if (input.target > input.previousTarget) {
    const increase = input.target - input.previousTarget;
    const removable = Math.min(availableUnits, increase);
    availableUnits -= removable;
    appliedUnits += removable;
    outstandingUnits += increase - removable;
    ledgerDelta = -removable;
  } else {
    let decrease = input.previousTarget - input.target;
    const clearedOutstanding = Math.min(outstandingUnits, decrease);
    outstandingUnits -= clearedOutstanding;
    decrease -= clearedOutstanding;
    const restorable = Math.min(appliedUnits, decrease);
    appliedUnits -= restorable;
    availableUnits += restorable;
    ledgerDelta = restorable;
  }
  if (appliedUnits + outstandingUnits !== input.target || availableUnits > input.grantedUnits) throw new MerchantFinancialEvidenceError("CREDIT_CLAWBACK_INVARIANT_FAILED");
  return { appliedUnits, outstandingUnits, availableUnits, ledgerDelta };
}

export function reconcileReleasedCredits(input: { releasedUnits: number; appliedUnits: number; outstandingUnits: number; availableUnits: number; grantedUnits: number; targetUnits: number }) {
  for (const value of Object.values(input)) if (!Number.isSafeInteger(value) || value < 0) throw new MerchantFinancialEvidenceError("CREDIT_CLAWBACK_INVARIANT_FAILED");
  if (input.appliedUnits + input.outstandingUnits !== input.targetUnits || input.targetUnits > input.grantedUnits) throw new MerchantFinancialEvidenceError("CREDIT_CLAWBACK_INVARIANT_FAILED");
  const releasedBalanceUnits = input.availableUnits + input.releasedUnits;
  if (releasedBalanceUnits > input.grantedUnits) throw new MerchantFinancialEvidenceError("CREDIT_CLAWBACK_INVARIANT_FAILED");
  const clawbackUnits = Math.min(input.releasedUnits, input.outstandingUnits);
  return { releasedBalanceUnits, availableUnits: releasedBalanceUnits - clawbackUnits, clawbackUnits, appliedUnits: input.appliedUnits + clawbackUnits, outstandingUnits: input.outstandingUnits - clawbackUnits };
}
