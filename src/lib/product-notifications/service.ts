import "server-only";
import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, lt, lte, or } from "drizzle-orm";
import { canonicalDigest } from "@/lib/agent-tools/canonical";
import { getEmailSender, type EmailSender, type TransactionalEmail } from "@/lib/auth/email-sender";
import { getDb } from "@/lib/db";
import {
  merchantBillingTransactions,
  merchantCreditLiabilities,
  merchantExecutionHolds,
  user,
  workspaceInterfaceLocalePreferences,
  workspaceMembers,
  workspaceNotificationEvents,
  workspaceNotificationPreferences,
  workspaceNotificationRecipients,
  workspaceSettings,
} from "@/lib/db/schema";
import { renderBillingNotification, type BillingNotificationEventType, type BillingNotificationFacts } from "@/i18n/notifications";
import type { AppLocale } from "@/i18n/config";
import { resolveWorkspaceMemberPermissions } from "@/lib/studio/authz";
import type { MerchantAdjustmentEvent } from "@/lib/commercial/merchant";

type Db = ReturnType<typeof getDb>;
type Recipient = typeof workspaceNotificationRecipients.$inferSelect;
type Claim = Recipient & { leaseOwner: string; attempt: number };
const NOTIFICATION_CATALOG_VERSION = "workspace-notifications/2026-09-05.1";

export class WorkspaceNotificationError extends Error {
  constructor(readonly code: string) { super(code); this.name = "WorkspaceNotificationError"; }
}

export class WorkspaceNotificationService {
  constructor(
    private readonly database: Db = getDb(),
    private readonly sender?: EmailSender,
    private readonly now = () => new Date(),
    private readonly canReadBilling = async (workspaceId: string, userId: string) => (await resolveWorkspaceMemberPermissions({ workspaceId, userId })).includes("product:billing:read"),
  ) {}

  async recordBillingAdjustment(event: MerchantAdjustmentEvent) {
    const [transaction] = await this.database.select().from(merchantBillingTransactions).where(and(eq(merchantBillingTransactions.provider, event.provider), eq(merchantBillingTransactions.transactionRef, event.transactionRef))).limit(1);
    if (!transaction) throw new WorkspaceNotificationError("NOTIFICATION_TRANSACTION_NOT_READY");
    const eventType = billingNotificationEventType(event, transaction.status);
    if (!eventType) return { state: "ignored" as const };
    const [[liability], [hold]] = await Promise.all([
      this.database.select().from(merchantCreditLiabilities).where(and(eq(merchantCreditLiabilities.provider, event.provider), eq(merchantCreditLiabilities.transactionRef, event.transactionRef))).limit(1),
      this.database.select().from(merchantExecutionHolds).where(and(eq(merchantExecutionHolds.provider, event.provider), eq(merchantExecutionHolds.transactionRef, event.transactionRef))).limit(1),
    ]);
    const facts: BillingNotificationFacts = {
      amountMinor: event.amountMinor,
      refundedMinor: transaction.refundedMinor,
      currency: transaction.currency,
      transactionRef: transaction.transactionRef,
      outstandingCredits: liability?.outstandingUnits ?? 0,
      executionHold: hold?.state === "active" || hold?.state === "released" ? hold.state : "none",
    };
    assertBillingFacts(facts);
    const sourceRef = `merchant:${event.provider}:${event.eventId}`;
    const at = this.now();
    const inserted = await this.database.insert(workspaceNotificationEvents).values({ workspaceId: transaction.workspaceId, id: randomUUID(), eventType, sourceRef, severity: eventType === "billing.dispute_opened" ? "critical" : facts.outstandingCredits > 0 || facts.executionHold === "active" ? "warning" : "info", facts: { ...facts }, actionPath: "/billing", occurredAt: event.occurredAt, createdAt: at }).onConflictDoNothing().returning();
    const [stored] = inserted[0] ? inserted : await this.database.select().from(workspaceNotificationEvents).where(and(eq(workspaceNotificationEvents.workspaceId, transaction.workspaceId), eq(workspaceNotificationEvents.sourceRef, sourceRef))).limit(1);
    if (!stored || canonicalDigest(stored.facts) !== canonicalDigest(facts)) throw new WorkspaceNotificationError("NOTIFICATION_EVENT_REPLAY_CONFLICT");
    const recipients = await this.notificationCandidates(transaction.workspaceId);
    let created = 0;
    for (const recipient of recipients) {
      if (!(await this.canReadBilling(transaction.workspaceId, recipient.userId))) continue;
      const locale = normalizeLocale(recipient.preferredLocale ?? recipient.interfaceLocale ?? recipient.defaultLocale);
      const snapshot = billingDeliverySnapshot(locale, eventType, facts, "/billing");
      const rows = await this.database.insert(workspaceNotificationRecipients).values({ workspaceId: transaction.workspaceId, eventId: stored.id, userId: recipient.userId, deliveryLocale: locale, inAppState: "unread", emailState: recipient.emailVerified && recipient.billingEmailEnabled !== false ? "pending" : "suppressed", attempt: 0, maxAttempts: 8, nextAttemptAt: at, catalogVersion: snapshot.catalogVersion, renderedTitle: snapshot.title, renderedBody: snapshot.body, renderedActionLabel: snapshot.actionLabel, emailActionUrl: snapshot.actionUrl, emailPayloadDigest: snapshot.payloadDigest, createdAt: at, updatedAt: at }).onConflictDoNothing().returning({ userId: workspaceNotificationRecipients.userId });
      created += rows.length;
    }
    return { state: "recorded" as const, eventId: stored.id, recipientsCreated: created };
  }

  async listForUser(input: { workspaceId: string; userId: string; unreadOnly?: boolean; limit?: number }) {
    const limit = Math.min(Math.max(Number.isInteger(input.limit) ? input.limit! : 50, 1), 100);
    const rows = await this.database.select({ recipient: workspaceNotificationRecipients, event: workspaceNotificationEvents }).from(workspaceNotificationRecipients).innerJoin(workspaceNotificationEvents, and(eq(workspaceNotificationEvents.workspaceId, workspaceNotificationRecipients.workspaceId), eq(workspaceNotificationEvents.id, workspaceNotificationRecipients.eventId))).where(and(eq(workspaceNotificationRecipients.workspaceId, input.workspaceId), eq(workspaceNotificationRecipients.userId, input.userId), input.unreadOnly ? eq(workspaceNotificationRecipients.inAppState, "unread") : undefined)).orderBy(desc(workspaceNotificationEvents.occurredAt), desc(workspaceNotificationEvents.id)).limit(limit);
    return rows.map(({ recipient, event }) => {
      const locale = normalizeLocale(recipient.deliveryLocale);
      const rendered = recipient.renderedTitle && recipient.renderedBody && recipient.renderedActionLabel && recipient.catalogVersion
        ? { locale, catalogVersion: recipient.catalogVersion, title: recipient.renderedTitle, body: recipient.renderedBody, actionLabel: recipient.renderedActionLabel }
        : renderBillingNotification(locale, NOTIFICATION_CATALOG_VERSION, event.eventType as BillingNotificationEventType, parseBillingFacts(event.facts));
      return { id: event.id, eventType: event.eventType, severity: event.severity, actionPath: event.actionPath, occurredAt: event.occurredAt.toISOString(), read: recipient.inAppState === "read", emailState: recipient.emailState, ...rendered };
    });
  }

  async setRead(input: { workspaceId: string; eventId: string; userId: string; read: boolean }) {
    const at = this.now();
    const [updated] = await this.database.update(workspaceNotificationRecipients).set({ inAppState: input.read ? "read" : "unread", readAt: input.read ? at : null, updatedAt: at }).where(and(eq(workspaceNotificationRecipients.workspaceId, input.workspaceId), eq(workspaceNotificationRecipients.eventId, input.eventId), eq(workspaceNotificationRecipients.userId, input.userId))).returning({ eventId: workspaceNotificationRecipients.eventId, inAppState: workspaceNotificationRecipients.inAppState });
    if (!updated) throw new WorkspaceNotificationError("NOTIFICATION_NOT_FOUND");
    return { eventId: updated.eventId, read: updated.inAppState === "read" };
  }

  async getPreferences(workspaceId: string, userId: string) {
    const [stored] = await this.database.select().from(workspaceNotificationPreferences).where(and(eq(workspaceNotificationPreferences.workspaceId, workspaceId), eq(workspaceNotificationPreferences.userId, userId))).limit(1);
    return { deliveryLocale: stored?.deliveryLocale === "ar" || stored?.deliveryLocale === "en" ? stored.deliveryLocale : null, billingEmailEnabled: stored?.billingEmailEnabled ?? true };
  }

  async updatePreferences(input: { workspaceId: string; userId: string; deliveryLocale: AppLocale | null; billingEmailEnabled: boolean }) {
    const at = this.now();
    const [stored] = await this.database.insert(workspaceNotificationPreferences).values({ ...input, createdAt: at, updatedAt: at }).onConflictDoUpdate({ target: [workspaceNotificationPreferences.workspaceId, workspaceNotificationPreferences.userId], set: { deliveryLocale: input.deliveryLocale, billingEmailEnabled: input.billingEmailEnabled, updatedAt: at } }).returning();
    return { deliveryLocale: stored.deliveryLocale as AppLocale | null, billingEmailEnabled: stored.billingEmailEnabled };
  }

  async dispatchEmail(limit = 20) {
    const claims = await this.claimEmail(limit, this.now());
    const summary = { inspected: claims.length, delivered: 0, suppressed: 0, retryScheduled: 0, failedKnown: 0, outcomeUnknown: 0 };
    for (const claim of claims) {
      const state = await this.deliverEmail(claim);
      if (state === "delivered") summary.delivered += 1;
      else if (state === "suppressed") summary.suppressed += 1;
      else if (state === "pending") summary.retryScheduled += 1;
      else if (state === "failed_known") summary.failedKnown += 1;
      else summary.outcomeUnknown += 1;
    }
    return summary;
  }

  private notificationCandidates(workspaceId: string) {
    return this.database.select({ userId: workspaceMembers.userId, emailVerified: user.emailVerified, preferredLocale: workspaceNotificationPreferences.deliveryLocale, billingEmailEnabled: workspaceNotificationPreferences.billingEmailEnabled, interfaceLocale: workspaceInterfaceLocalePreferences.interfaceLocale, defaultLocale: workspaceSettings.defaultInterfaceLocale }).from(workspaceMembers).innerJoin(user, eq(user.id, workspaceMembers.userId)).leftJoin(workspaceNotificationPreferences, and(eq(workspaceNotificationPreferences.workspaceId, workspaceMembers.workspaceId), eq(workspaceNotificationPreferences.userId, workspaceMembers.userId))).leftJoin(workspaceInterfaceLocalePreferences, and(eq(workspaceInterfaceLocalePreferences.workspaceId, workspaceMembers.workspaceId), eq(workspaceInterfaceLocalePreferences.userId, workspaceMembers.userId))).leftJoin(workspaceSettings, eq(workspaceSettings.workspaceId, workspaceMembers.workspaceId)).where(eq(workspaceMembers.workspaceId, workspaceId));
  }

  private async claimEmail(limit: number, at: Date) {
    const leaseOwner = randomUUID();
    const leaseExpiresAt = new Date(at.getTime() + 50_000);
    return this.database.transaction(async (tx) => {
      const rows = await tx.select().from(workspaceNotificationRecipients).where(and(lte(workspaceNotificationRecipients.nextAttemptAt, at), or(and(eq(workspaceNotificationRecipients.emailState, "pending"), lt(workspaceNotificationRecipients.attempt, workspaceNotificationRecipients.maxAttempts)), and(eq(workspaceNotificationRecipients.emailState, "processing"), lte(workspaceNotificationRecipients.leaseExpiresAt, at))))).orderBy(asc(workspaceNotificationRecipients.nextAttemptAt), asc(workspaceNotificationRecipients.workspaceId), asc(workspaceNotificationRecipients.eventId), asc(workspaceNotificationRecipients.userId)).limit(Math.min(Math.max(Number.isInteger(limit) ? limit : 20, 1), 50)).for("update", { skipLocked: true });
      const claims: Claim[] = [];
      for (const row of rows) {
        const attempt = row.emailState === "processing" ? row.attempt : row.attempt + 1;
        if (attempt > row.maxAttempts) continue;
        const [claimed] = await tx.update(workspaceNotificationRecipients).set({ emailState: "processing", attempt, leaseOwner, leaseExpiresAt, lastErrorCode: null, updatedAt: at }).where(and(eq(workspaceNotificationRecipients.workspaceId, row.workspaceId), eq(workspaceNotificationRecipients.eventId, row.eventId), eq(workspaceNotificationRecipients.userId, row.userId))).returning();
        if (claimed) claims.push({ ...claimed, leaseOwner, attempt });
      }
      return claims;
    });
  }

  private async deliverEmail(claim: Claim): Promise<"pending" | "delivered" | "suppressed" | "failed_known" | "outcome_unknown"> {
    try {
      const [record] = await this.database.select({ event: workspaceNotificationEvents, recipientEmail: user.email, emailVerified: user.emailVerified, billingEmailEnabled: workspaceNotificationPreferences.billingEmailEnabled }).from(workspaceNotificationEvents).innerJoin(user, eq(user.id, claim.userId)).leftJoin(workspaceNotificationPreferences, and(eq(workspaceNotificationPreferences.workspaceId, claim.workspaceId), eq(workspaceNotificationPreferences.userId, claim.userId))).where(and(eq(workspaceNotificationEvents.workspaceId, claim.workspaceId), eq(workspaceNotificationEvents.id, claim.eventId))).limit(1);
      if (!record) return this.finalizeEmail(claim, "failed_known", "NOTIFICATION_RECIPIENT_UNAVAILABLE");
      if (!record.emailVerified || record.billingEmailEnabled === false) return this.finalizeEmail(claim, "suppressed", "NOTIFICATION_EMAIL_DISABLED");
      const locale = normalizeLocale(claim.deliveryLocale);
      const snapshot = claim.renderedTitle && claim.renderedBody && claim.renderedActionLabel && claim.emailActionUrl && claim.catalogVersion
        ? { locale, catalogVersion: claim.catalogVersion, title: claim.renderedTitle, body: claim.renderedBody, actionLabel: claim.renderedActionLabel, actionUrl: claim.emailActionUrl, payloadDigest: claim.emailPayloadDigest }
        : billingDeliverySnapshot(locale, record.event.eventType as BillingNotificationEventType, parseBillingFacts(record.event.facts), record.event.actionPath);
      if (snapshot.payloadDigest && snapshot.payloadDigest !== deliveryPayloadDigest(snapshot)) return this.finalizeEmail(claim, "failed_known", "NOTIFICATION_PAYLOAD_DIGEST_MISMATCH");
      await (this.sender ?? getEmailSender()).send(notificationEmail({ to: record.recipientEmail, locale, rendered: snapshot, actionUrl: snapshot.actionUrl, idempotencyKey: notificationIdempotencyKey(claim) }));
      return this.finalizeEmail(claim, "delivered", null);
    } catch (error) {
      const state = claim.attempt >= claim.maxAttempts ? "outcome_unknown" : "pending";
      return this.finalizeEmail(claim, state, error instanceof Error ? error.message.slice(0, 200) : "UNKNOWN");
    }
  }

  private async finalizeEmail(claim: Claim, state: "pending" | "delivered" | "suppressed" | "failed_known" | "outcome_unknown", code: string | null) {
    const at = this.now();
    const [updated] = await this.database.update(workspaceNotificationRecipients).set({ emailState: state, leaseOwner: null, leaseExpiresAt: null, lastErrorCode: code, nextAttemptAt: new Date(at.getTime() + notificationRetryDelayMs(claim.attempt)), emailDeliveredAt: state === "delivered" ? at : null, updatedAt: at }).where(and(eq(workspaceNotificationRecipients.workspaceId, claim.workspaceId), eq(workspaceNotificationRecipients.eventId, claim.eventId), eq(workspaceNotificationRecipients.userId, claim.userId), eq(workspaceNotificationRecipients.emailState, "processing"), eq(workspaceNotificationRecipients.leaseOwner, claim.leaseOwner))).returning({ emailState: workspaceNotificationRecipients.emailState });
    if (updated) return state;
    const [current] = await this.database.select({ emailState: workspaceNotificationRecipients.emailState }).from(workspaceNotificationRecipients).where(and(eq(workspaceNotificationRecipients.workspaceId, claim.workspaceId), eq(workspaceNotificationRecipients.eventId, claim.eventId), eq(workspaceNotificationRecipients.userId, claim.userId))).limit(1);
    return current?.emailState === "delivered" || current?.emailState === "suppressed" || current?.emailState === "failed_known" || current?.emailState === "outcome_unknown" ? current.emailState : "outcome_unknown";
  }
}

export function billingNotificationEventType(event: Pick<MerchantAdjustmentEvent, "action" | "status">, transactionStatus: string): BillingNotificationEventType | null {
  if (event.status !== "approved") return null;
  if (event.action === "chargeback" || event.action === "chargeback_warning") return "billing.dispute_opened";
  if (event.action === "chargeback_reverse" || event.action === "chargeback_warning_reverse" || transactionStatus === "chargeback_reversed") return "billing.dispute_resolved";
  if (event.action === "credit_reverse") return "billing.refund_reversed";
  if (event.action === "refund" || event.action === "credit") return "billing.refund_applied";
  return null;
}

export function notificationRetryDelayMs(attempt: number) {
  return Math.min(30 * 60_000, 60_000 * 2 ** Math.min(Math.max(Number.isSafeInteger(attempt) ? attempt : 0, 0), 5));
}

function normalizeLocale(value: unknown): AppLocale { return value === "en" ? "en" : "ar"; }

function assertBillingFacts(value: BillingNotificationFacts) {
  if (!Number.isSafeInteger(value.amountMinor) || value.amountMinor < 0 || !Number.isSafeInteger(value.refundedMinor) || value.refundedMinor < 0 || !Number.isSafeInteger(value.outstandingCredits) || value.outstandingCredits < 0 || !/^[A-Z]{3}$/.test(value.currency) || !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/.test(value.transactionRef) || !["active", "released", "none"].includes(value.executionHold)) throw new WorkspaceNotificationError("NOTIFICATION_FACTS_INVALID");
}

function parseBillingFacts(value: Record<string, string | number | boolean | null>): BillingNotificationFacts {
  const facts = value as unknown as BillingNotificationFacts;
  assertBillingFacts(facts);
  return facts;
}

export function notificationIdempotencyKey({ workspaceId, eventId, userId }: Pick<Claim, "workspaceId" | "eventId" | "userId">) {
  return `notification/${canonicalDigest({ workspaceId, eventId, userId }).slice("sha256:".length)}`;
}

function billingDeliverySnapshot(locale: AppLocale, eventType: BillingNotificationEventType, facts: BillingNotificationFacts, actionPath: string) {
  const rendered = renderBillingNotification(locale, NOTIFICATION_CATALOG_VERSION, eventType, facts);
  const actionUrl = notificationActionUrl(actionPath);
  const snapshot = { ...rendered, actionUrl };
  return { ...snapshot, payloadDigest: deliveryPayloadDigest(snapshot) };
}

function deliveryPayloadDigest(input: { locale: AppLocale; catalogVersion: string; title: string; body: string; actionLabel: string; actionUrl: string }) {
  return canonicalDigest({ locale: input.locale, catalogVersion: input.catalogVersion, title: input.title, body: input.body, actionLabel: input.actionLabel, actionUrl: input.actionUrl });
}

function notificationActionUrl(actionPath: string) {
  const base = process.env.NEXT_PUBLIC_APP_URL?.trim() || "http://localhost:3000";
  const actionUrl = new URL(actionPath, base);
  if (!['http:', 'https:'].includes(actionUrl.protocol)) throw new WorkspaceNotificationError("NOTIFICATION_ACTION_URL_INVALID");
  return actionUrl.toString();
}

function notificationEmail(input: { to: string; locale: AppLocale; rendered: { title: string; body: string; actionLabel: string }; actionUrl: string; idempotencyKey: string }): TransactionalEmail {
  const direction = input.locale === "ar" ? "rtl" : "ltr";
  return { to: input.to, subject: input.rendered.title, text: `${input.rendered.body}\n${input.actionUrl}`, html: `<section lang="${input.locale}" dir="${direction}"><p>${escapeHtml(input.rendered.body)}</p><p><a href="${escapeHtml(input.actionUrl)}">${escapeHtml(input.rendered.actionLabel)}</a></p></section>`, idempotencyKey: input.idempotencyKey };
}

function escapeHtml(value: string) { return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;"); }
