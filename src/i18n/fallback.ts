import { catalogs } from "./catalog";
import type { AppLocale } from "./config";

const genericFallback = {
  ar: "تعذر عرض النص",
  en: "Text unavailable",
} as const;

export function otherLocale(locale: AppLocale): AppLocale {
  return locale === "ar" ? "en" : "ar";
}

function readMessage(catalog: unknown, path: string): string | null {
  let current = catalog;
  for (const segment of path.split(".")) {
    if (!current || typeof current !== "object" || !(segment in current)) return null;
    current = (current as Record<string, unknown>)[segment];
  }
  return typeof current === "string" ? current : null;
}

/** Never returns the failed semantic key. */
export function getAuthoredMessageFallback(
  locale: AppLocale,
  namespace: string | undefined,
  key: string,
): { locale: AppLocale; message: string } {
  const fallbackLocale = otherLocale(locale);
  const path = namespace ? `${namespace}.${key}` : key;
  return {
    locale: fallbackLocale,
    message: readMessage(catalogs[fallbackLocale], path) ?? genericFallback[fallbackLocale],
  };
}
