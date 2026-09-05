import "server-only";
import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, lt, lte, or } from "drizzle-orm";
import { canonicalDigest } from "@/lib/agent-tools/canonical";
import { getDb } from "@/lib/db";
import { merchantAdjustmentWebhookReceipts } from "@/lib/db/schema";
import type { MerchantAdjustmentEvent } from "./merchant";
import { MerchantFinancialEvidenceError, MerchantFinancialEvidenceService } from "./financial-evidence";

type Db = ReturnType<typeof getDb>;
type Receipt = typeof merchantAdjustmentWebhookReceipts.$inferSelect;
type Claim = Receipt & { leaseOwner: string; attempt: number };
export interface MerchantAdjustmentNotificationRecorder { recordBillingAdjustment(event: MerchantAdjustmentEvent): Promise<unknown> }

const claimableStates = ["received", "pending_dependency"] as const;
const terminalStates = new Set(["applied", "failed_known"]);

export class MerchantAdjustmentInboxService {
  constructor(
    private readonly database: Db = getDb(),
    private readonly financials = new MerchantFinancialEvidenceService(database),
    private readonly now = () => new Date(),
    private readonly notifications?: MerchantAdjustmentNotificationRecorder,
  ) {}

  async applyVerifiedEvent(event: MerchantAdjustmentEvent) {
    const payloadDigest = canonicalDigest(serializeMerchantAdjustmentEvent(event));
    const at = this.now();
    const inserted = await this.database.insert(merchantAdjustmentWebhookReceipts).values({ provider: event.provider, eventId: event.eventId, payloadDigest, adjustmentRef: event.adjustmentRef, transactionRef: event.transactionRef, merchantSubscriptionRef: event.merchantSubscriptionRef, merchantCustomerRef: event.merchantCustomerRef, action: event.action, status: event.status, amountMinor: event.amountMinor, currency: event.currency, reason: event.reason, state: "received", attempt: 0, maxAttempts: 12, nextAttemptAt: at, providerOccurredAt: event.occurredAt, receivedAt: at, updatedAt: at }).onConflictDoNothing().returning();
    const [receipt] = inserted[0] ? inserted : await this.database.select().from(merchantAdjustmentWebhookReceipts).where(and(eq(merchantAdjustmentWebhookReceipts.provider, event.provider), eq(merchantAdjustmentWebhookReceipts.eventId, event.eventId))).limit(1);
    if (!receipt || receipt.payloadDigest !== payloadDigest || receipt.transactionRef !== event.transactionRef) throw new MerchantFinancialEvidenceError("ADJUSTMENT_INBOX_REPLAY_CONFLICT");
    if (terminalStates.has(receipt.state)) return { state: receipt.state as "applied" | "failed_known" };
    const claim = await this.claimSpecific(event.provider, event.eventId, at);
    return claim ? this.processClaim(claim) : { state: receipt.state as "received" | "pending_dependency" | "processing" | "outcome_unknown" };
  }

  async reconcile(limit = 20) {
    const claims = await this.claimDue(limit, this.now());
    const summary = { inspected: claims.length, applied: 0, pendingDependency: 0, retryScheduled: 0, failedKnown: 0, outcomeUnknown: 0 };
    for (const claim of claims) {
      const result = await this.processClaim(claim);
      if (result.state === "applied") summary.applied += 1;
      else if (result.state === "pending_dependency") summary.pendingDependency += 1;
      else if (result.state === "failed_known") summary.failedKnown += 1;
      else if (result.state === "received") summary.retryScheduled += 1;
      else summary.outcomeUnknown += 1;
    }
    return summary;
  }

  private async claimSpecific(provider: string, eventId: string, at: Date) {
    const claims = await this.claim(at, 1, and(eq(merchantAdjustmentWebhookReceipts.provider, provider), eq(merchantAdjustmentWebhookReceipts.eventId, eventId)));
    return claims[0] ?? null;
  }

  private async claimDue(limit: number, at: Date) {
    return this.claim(at, Math.min(Math.max(Number.isInteger(limit) ? limit : 20, 1), 50));
  }

  private async claim(at: Date, limit: number, scope?: ReturnType<typeof and>) {
    const leaseOwner = randomUUID();
    const leaseExpiresAt = new Date(at.getTime() + 50_000);
    return this.database.transaction(async (tx) => {
      const eligible = and(
        lte(merchantAdjustmentWebhookReceipts.nextAttemptAt, at),
        or(
          and(inArray(merchantAdjustmentWebhookReceipts.state, claimableStates), lt(merchantAdjustmentWebhookReceipts.attempt, merchantAdjustmentWebhookReceipts.maxAttempts)),
          and(eq(merchantAdjustmentWebhookReceipts.state, "processing"), lte(merchantAdjustmentWebhookReceipts.leaseExpiresAt, at)),
        ),
        scope,
      );
      const rows = await tx.select().from(merchantAdjustmentWebhookReceipts).where(eligible).orderBy(asc(merchantAdjustmentWebhookReceipts.nextAttemptAt), asc(merchantAdjustmentWebhookReceipts.provider), asc(merchantAdjustmentWebhookReceipts.eventId)).limit(limit).for("update", { skipLocked: true });
      const claims: Claim[] = [];
      for (const row of rows) {
        const attempt = row.state === "processing" ? row.attempt : row.attempt + 1;
        const [claimed] = await tx.update(merchantAdjustmentWebhookReceipts).set({ state: "processing", attempt, leaseOwner, leaseExpiresAt, lastErrorCode: null, updatedAt: at }).where(and(eq(merchantAdjustmentWebhookReceipts.provider, row.provider), eq(merchantAdjustmentWebhookReceipts.eventId, row.eventId))).returning();
        if (claimed) claims.push({ ...claimed, leaseOwner, attempt });
      }
      return claims;
    });
  }

  private async processClaim(claim: Claim) {
    try {
      const event = hydrateMerchantAdjustmentEvent(claim);
      const financialResult = await this.financials.applyAdjustment(event);
      if (financialResult.state === "applied" && this.notifications) await this.notifications.recordBillingAdjustment(event);
      const at = this.now();
      await this.database.update(merchantAdjustmentWebhookReceipts).set({ state: "applied", leaseOwner: null, leaseExpiresAt: null, lastErrorCode: null, updatedAt: at, processedAt: at }).where(and(eq(merchantAdjustmentWebhookReceipts.provider, claim.provider), eq(merchantAdjustmentWebhookReceipts.eventId, claim.eventId), eq(merchantAdjustmentWebhookReceipts.state, "processing"), eq(merchantAdjustmentWebhookReceipts.leaseOwner, claim.leaseOwner)));
      return { state: "applied" as const };
    } catch (error) {
      const code = error instanceof Error ? error.message.slice(0, 200) : "UNKNOWN";
      const state = merchantAdjustmentFailureState({ code, attempt: claim.attempt, maxAttempts: claim.maxAttempts });
      const at = this.now();
      const retryKind = state === "pending_dependency" ? "pending_dependency" : "error";
      await this.database.update(merchantAdjustmentWebhookReceipts).set({ state, leaseOwner: null, leaseExpiresAt: null, lastErrorCode: code, nextAttemptAt: new Date(at.getTime() + merchantAdjustmentRetryDelayMs(claim.attempt, retryKind)), updatedAt: at, processedAt: state === "failed_known" || state === "outcome_unknown" ? at : null }).where(and(eq(merchantAdjustmentWebhookReceipts.provider, claim.provider), eq(merchantAdjustmentWebhookReceipts.eventId, claim.eventId), eq(merchantAdjustmentWebhookReceipts.state, "processing"), eq(merchantAdjustmentWebhookReceipts.leaseOwner, claim.leaseOwner)));
      return { state };
    }
  }
}

export function merchantAdjustmentRetryDelayMs(attempt: number, kind: "pending_dependency" | "error") {
  const base = kind === "pending_dependency" ? 15_000 : 60_000;
  return Math.min(15 * 60_000, base * 2 ** Math.min(Math.max(Number.isSafeInteger(attempt) ? attempt : 0, 0), 6));
}

export function merchantAdjustmentFailureState(input: { code: string; attempt: number; maxAttempts: number }): "received" | "pending_dependency" | "failed_known" | "outcome_unknown" {
  const exhausted = input.attempt >= input.maxAttempts;
  if (["ADJUSTMENT_TRANSACTION_NOT_READY", "ADJUSTMENT_CREDIT_BUCKET_NOT_READY", "ADJUSTMENT_SUBSCRIPTION_PERIOD_NOT_READY"].includes(input.code)) return exhausted ? "failed_known" : "pending_dependency";
  if (input.code.startsWith("ADJUSTMENT_") || input.code === "BILLING_TRANSACTION_REPLAY_CONFLICT" || input.code.startsWith("CREDIT_CLAWBACK_") || input.code === "SUBSCRIPTION_FINANCIAL_HOLD_INPUT_INVALID") return "failed_known";
  return exhausted ? "outcome_unknown" : "received";
}

function serializeMerchantAdjustmentEvent(event: MerchantAdjustmentEvent) {
  return { ...event, occurredAt: event.occurredAt.toISOString() };
}

function hydrateMerchantAdjustmentEvent(receipt: Receipt): MerchantAdjustmentEvent {
  return { provider: receipt.provider, eventId: receipt.eventId, adjustmentRef: receipt.adjustmentRef, transactionRef: receipt.transactionRef, merchantSubscriptionRef: receipt.merchantSubscriptionRef, merchantCustomerRef: receipt.merchantCustomerRef, action: receipt.action as MerchantAdjustmentEvent["action"], status: receipt.status as MerchantAdjustmentEvent["status"], amountMinor: receipt.amountMinor, currency: receipt.currency, reason: receipt.reason, occurredAt: receipt.providerOccurredAt };
}
