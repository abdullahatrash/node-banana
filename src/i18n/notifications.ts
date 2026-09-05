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
