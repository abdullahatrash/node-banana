import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { merchantBillingAdjustmentEvents, merchantBillingAdjustments, merchantBillingTransactions, merchantCheckoutSessions } from "@/lib/db/schema";
import type { MerchantAdjustmentEvent, MerchantCheckoutEvent, MerchantSubscriptionEvent } from "./merchant";

type Db = ReturnType<typeof getDb>;

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
      providerOccurredAt: event.occurredAt,
    });
  }

  async applyAdjustment(event: MerchantAdjustmentEvent) {
    return this.database.transaction(async (tx) => {
      const [transaction] = await tx.select().from(merchantBillingTransactions).where(and(eq(merchantBillingTransactions.provider, event.provider), eq(merchantBillingTransactions.transactionRef, event.transactionRef))).for("update").limit(1);
      if (!transaction) throw new MerchantFinancialEvidenceError("ADJUSTMENT_TRANSACTION_NOT_READY");
      if (transaction.currency !== event.currency || transaction.merchantCustomerRef !== event.merchantCustomerRef || (event.merchantSubscriptionRef && transaction.merchantSubscriptionRef !== event.merchantSubscriptionRef)) throw new MerchantFinancialEvidenceError("ADJUSTMENT_TRANSACTION_MISMATCH");
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
      return { state: "applied" as const, transactionStatus: status, refundedMinor };
    });
  }

  private async recordTransaction(input: Omit<typeof merchantBillingTransactions.$inferInsert, "refundedMinor" | "status" | "updatedAt">) {
    const inserted = await this.database.insert(merchantBillingTransactions).values({ ...input, refundedMinor: 0, status: "completed", updatedAt: this.now() }).onConflictDoNothing().returning();
    if (inserted[0]) return { state: "recorded" as const };
    const [current] = await this.database.select().from(merchantBillingTransactions).where(and(eq(merchantBillingTransactions.provider, input.provider), eq(merchantBillingTransactions.transactionRef, input.transactionRef))).limit(1);
    if (!current || current.workspaceId !== input.workspaceId || current.amountMinor !== input.amountMinor || current.currency !== input.currency || current.merchantCustomerRef !== input.merchantCustomerRef || current.merchantSubscriptionRef !== input.merchantSubscriptionRef) throw new MerchantFinancialEvidenceError("BILLING_TRANSACTION_REPLAY_CONFLICT");
    return { state: "recorded" as const };
  }
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
