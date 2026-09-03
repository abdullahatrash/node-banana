import { createTranslator } from "next-intl";
import { catalogs } from "./catalog";
import type { AppLocale } from "./config";

export type NotificationTemplate =
  | { event: "generation.ready"; name: string }
  | { event: "publishing.failed"; name: string };

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
