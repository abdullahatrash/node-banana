import { getIntlLocale, type AppLocale } from "./config";

export interface FormatPreferences {
  locale: AppLocale;
  numeralSystem?: "arab" | "latn";
  timeZone?: string;
  calendarPresentation?: "gregorian" | "gregorian-with-hijri";
}

export function formatNumber(value: number, preferences: FormatPreferences, options?: Intl.NumberFormatOptions) {
  return new Intl.NumberFormat(getIntlLocale(preferences.locale, preferences.numeralSystem), options).format(value);
}

export function formatCurrency(value: number, currency: string, preferences: FormatPreferences) {
  return formatNumber(value, preferences, { style: "currency", currency });
}

export function formatUnit(
  value: number,
  unit: Intl.NumberFormatOptions["unit"],
  preferences: FormatPreferences,
  unitDisplay: Intl.NumberFormatOptions["unitDisplay"] = "short",
) {
  return formatNumber(value, preferences, { style: "unit", unit, unitDisplay });
}

export function formatDate(value: Date | number | string, preferences: FormatPreferences, options: Intl.DateTimeFormatOptions = { dateStyle: "medium" }) {
  return new Intl.DateTimeFormat(getIntlLocale(preferences.locale, preferences.numeralSystem, "gregory"), {
    ...options,
    timeZone: preferences.timeZone,
  }).format(new Date(value));
}

export function formatDateWithOptionalHijri(
  value: Date | number | string,
  preferences: FormatPreferences,
  options: Intl.DateTimeFormatOptions = { dateStyle: "medium" },
) {
  const gregorian = formatDate(value, preferences, options);
  if (preferences.calendarPresentation !== "gregorian-with-hijri") {
    return { gregorian, hijri: null };
  }
  const hijri = new Intl.DateTimeFormat(
    getIntlLocale(preferences.locale, preferences.numeralSystem, "islamic-umalqura"),
    { ...options, timeZone: preferences.timeZone },
  ).format(new Date(value));
  return { gregorian, hijri };
}

export function formatRelativeTime(value: number, unit: Intl.RelativeTimeFormatUnit, preferences: FormatPreferences) {
  return new Intl.RelativeTimeFormat(getIntlLocale(preferences.locale, preferences.numeralSystem), { numeric: "auto" }).format(value, unit);
}

export function formatList(values: string[], preferences: FormatPreferences) {
  return new Intl.ListFormat(getIntlLocale(preferences.locale, preferences.numeralSystem), { style: "long", type: "conjunction" }).format(values);
}
