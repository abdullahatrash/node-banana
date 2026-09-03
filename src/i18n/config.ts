export const locales = ["ar", "en"] as const;

export type AppLocale = (typeof locales)[number];
export type AppDirection = "rtl" | "ltr";

export const defaultLocale: AppLocale = "ar";
export const localeCookieName = "NEXT_LOCALE";

export function isAppLocale(value: unknown): value is AppLocale {
  return typeof value === "string" && locales.includes(value as AppLocale);
}

export function getDirection(locale: AppLocale): AppDirection {
  return locale === "ar" ? "rtl" : "ltr";
}

export function getIntlLocale(
  locale: AppLocale,
  numeralSystem: "arab" | "latn" = "latn",
  calendar: "gregory" | "islamic-umalqura" = "gregory",
) {
  return `${locale}-u-ca-${calendar}-nu-${numeralSystem}`;
}

export function getPublicLocaleFromPath(pathname: string): AppLocale | null {
  const segment = pathname.split("/")[1];
  return isAppLocale(segment) ? segment : null;
}
