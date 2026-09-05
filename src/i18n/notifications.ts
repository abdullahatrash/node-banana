import { createTranslator } from "next-intl";
import { catalogs } from "./catalog";
import type { AppLocale } from "./config";

export type NotificationTemplate =
  | { event: "generation.ready"; name: string }
  | { event: "publishing.failed"; name: string };

export type BillingNotificationEventType =
  | "billing.refund_applied"
  | "billing.refund_reversed"
  | "billing.dispute_opened"
  | "billing.dispute_resolved";

export type WorkspaceNotificationEventType =
  | BillingNotificationEventType
  | "security.credential_created"
  | "security.credential_rotated"
  | "security.credential_revoked"
  | "security.credential_status_changed"
  | "security.spend_authority_changed"
  | "channel.consent_expiring"
  | "channel.reconnect_required"
  | "publishing.approval_requested"
  | "publishing.approval_approved"
  | "publishing.approval_denied"
  | "publishing.delivery_failed"
  | "publishing.delivery_outcome_unknown"
  | "publishing.social_failed"
  | "credits.low"
  | "credits.exhausted";

export type WorkspaceNotificationFacts = Record<string, string | number | boolean | null>;

export interface BillingNotificationFacts {
  amountMinor: number;
  refundedMinor: number;
  currency: string;
  transactionRef: string;
  outstandingCredits: number;
  executionHold: "active" | "released" | "none";
}

export interface LocalizedNotification {
  locale: AppLocale;
  catalogVersion: string;
  title: string;
  body: string;
}

export function renderNotification(
  locale: AppLocale,
  catalogVersion: string,
  template: NotificationTemplate,
): LocalizedNotification {
  const t = createTranslator({ locale, messages: catalogs[locale], namespace: "notifications" });
  if (template.event === "generation.ready") {
    return {
      locale,
      catalogVersion,
      title: t("generationReadyTitle"),
      body: t("generationReadyBody", { name: template.name }),
    };
  }
  return {
    locale,
    catalogVersion,
    title: t("publishingFailedTitle"),
    body: t("publishingFailedBody", { name: template.name }),
  };
}

export function renderBillingNotification(
  locale: AppLocale,
  catalogVersion: string,
  eventType: BillingNotificationEventType,
  facts: BillingNotificationFacts,
): LocalizedNotification & { actionLabel: string } {
  const t = createTranslator({ locale, messages: catalogs[locale], namespace: "notifications.billing" });
  const key = ({
    "billing.refund_applied": "refundApplied",
    "billing.refund_reversed": "refundReversed",
    "billing.dispute_opened": "disputeOpened",
    "billing.dispute_resolved": "disputeResolved",
  } as const)[eventType];
  const amount = new Intl.NumberFormat(locale, { style: "currency", currency: facts.currency }).format(facts.amountMinor / 100);
  return {
    locale,
    catalogVersion,
    title: t(`${key}Title`),
    body: t(`${key}Body`, {
      amount,
      transaction: `\u2068${facts.transactionRef}\u2069`,
      credits: facts.outstandingCredits,
      hold: t(`executionHold.${facts.executionHold}`),
    }),
    actionLabel: t("openBilling"),
  };
}

export function renderWorkspaceNotification(
  locale: AppLocale,
  catalogVersion: string,
  eventType: WorkspaceNotificationEventType,
  facts: WorkspaceNotificationFacts,
): LocalizedNotification & { actionLabel: string } {
  if (eventType.startsWith("billing.")) {
    return renderBillingNotification(locale, catalogVersion, eventType as BillingNotificationEventType, billingFacts(facts));
  }
  const t = createTranslator({ locale, messages: catalogs[locale], namespace: "notifications" });
  const isolate = (value: string) => `\u2068${value}\u2069`;
  if (eventType.startsWith("security.")) {
    const values = { name: textFact(facts, "resourceName"), provider: isolate(textFact(facts, "provider")), change: securityChangeLabel(locale, textFact(facts, "change")), reference: isolate(textFact(facts, "reference")) };
    if (eventType === "security.credential_created") return { locale, catalogVersion, title: t("security.credentialCreatedTitle"), body: t("security.credentialCreatedBody", values), actionLabel: t("security.openCredentials") };
    if (eventType === "security.credential_rotated") return { locale, catalogVersion, title: t("security.credentialRotatedTitle"), body: t("security.credentialRotatedBody", values), actionLabel: t("security.openCredentials") };
    if (eventType === "security.credential_revoked") return { locale, catalogVersion, title: t("security.credentialRevokedTitle"), body: t("security.credentialRevokedBody", values), actionLabel: t("security.openCredentials") };
    if (eventType === "security.credential_status_changed") return { locale, catalogVersion, title: t("security.credentialStatusChangedTitle"), body: t("security.credentialStatusChangedBody", values), actionLabel: t("security.openCredentials") };
    return { locale, catalogVersion, title: t("security.spendAuthorityChangedTitle"), body: t("security.spendAuthorityChangedBody", values), actionLabel: t("security.openCredentials") };
  }
  if (eventType.startsWith("channel.")) {
    const key = eventType === "channel.consent_expiring" ? "consentExpiring" : "reconnectRequired";
    const expiry = nullableTextFact(facts, "expiresAt");
    const expiryDate = expiry ? new Date(expiry) : null;
    if (expiryDate && Number.isNaN(expiryDate.getTime())) throw new Error("NOTIFICATION_FACTS_INVALID");
    const date = expiryDate ? new Intl.DateTimeFormat(locale, { dateStyle: "long" }).format(expiryDate) : t("channel.unknownDate");
    return { locale, catalogVersion, title: t(`channel.${key}Title`), body: t(`channel.${key}Body`, { channel: textFact(facts, "channelName"), platform: isolate(textFact(facts, "platform")), date }), actionLabel: t("channel.openChannels") };
  }
  if (eventType.startsWith("publishing.approval_")) {
    const key = ({ "publishing.approval_requested": "approvalRequested", "publishing.approval_approved": "approvalApproved", "publishing.approval_denied": "approvalDenied" } as const)[eventType as "publishing.approval_requested" | "publishing.approval_approved" | "publishing.approval_denied"];
    return { locale, catalogVersion, title: t(`publishing.${key}Title`), body: t(`publishing.${key}Body`, { request: isolate(textFact(facts, "requestId")), targets: numberFact(facts, "targetCount"), channels: numberFact(facts, "channelCount") }), actionLabel: t("publishing.openApprovals") };
  }
  if (eventType.startsWith("publishing.")) {
    const key = eventType === "publishing.delivery_failed" ? "deliveryFailed" : eventType === "publishing.delivery_outcome_unknown" ? "deliveryOutcomeUnknown" : "socialFailed";
    return { locale, catalogVersion, title: t(`publishing.${key}Title`), body: t(`publishing.${key}Body`, { reference: isolate(textFact(facts, "reference")), channel: isolate(textFact(facts, "channel")), failure: isolate(textFact(facts, "failureCode")) }), actionLabel: t(eventType === "publishing.social_failed" ? "publishing.openSocialEvents" : "publishing.openDeliveries") };
  }
  const key = eventType === "credits.exhausted" ? "exhausted" : "low";
  return { locale, catalogVersion, title: t(`credits.${key}Title`), body: t(`credits.${key}Body`, { credits: numberFact(facts, "availableCredits"), threshold: numberFact(facts, "warningThreshold") }), actionLabel: t("credits.openBilling") };
}

function securityChangeLabel(locale: AppLocale, change: string): string {
  const t = createTranslator({ locale, messages: catalogs[locale], namespace: "notifications.security.change" });
  if (change === "created") return t("created");
  if (change === "reprovisioned") return t("reprovisioned");
  if (change === "rotated") return t("rotated");
  if (change === "revoked") return t("revoked");
  if (change === "enabled") return t("enabled");
  if (change === "disabled") return t("disabled");
  throw new Error("NOTIFICATION_FACTS_INVALID");
}

function billingFacts(facts: WorkspaceNotificationFacts): BillingNotificationFacts {
  const hold = textFact(facts, "executionHold");
  if (!(["active", "released", "none"] as string[]).includes(hold)) throw new Error("NOTIFICATION_FACTS_INVALID");
  return { amountMinor: numberFact(facts, "amountMinor"), refundedMinor: numberFact(facts, "refundedMinor"), currency: textFact(facts, "currency"), transactionRef: textFact(facts, "transactionRef"), outstandingCredits: numberFact(facts, "outstandingCredits"), executionHold: hold as BillingNotificationFacts["executionHold"] };
}

function textFact(facts: WorkspaceNotificationFacts, key: string): string {
  const value = facts[key];
  if (typeof value !== "string" || !value.trim() || value.length > 500) throw new Error("NOTIFICATION_FACTS_INVALID");
  return value;
}

function nullableTextFact(facts: WorkspaceNotificationFacts, key: string): string | null {
  const value = facts[key];
  if (value === null) return null;
  return textFact(facts, key);
}

function numberFact(facts: WorkspaceNotificationFacts, key: string): number {
  const value = facts[key];
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new Error("NOTIFICATION_FACTS_INVALID");
  return value;
}
