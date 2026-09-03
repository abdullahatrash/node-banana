import type { ReactNode } from "react";
import { NextIntlClientProvider } from "next-intl";
import { catalogs } from "@/i18n/catalog";
import type { AppLocale } from "@/i18n/config";

export function I18nTestProvider({ children, locale = "ar" }: { children: ReactNode; locale?: AppLocale }) {
  return <NextIntlClientProvider locale={locale} messages={catalogs[locale]}>{children}</NextIntlClientProvider>;
}
