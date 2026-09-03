import type { AppLocale } from "./config";

export const catalogVersion = "2026-09-03.s0";

export interface LocalizationIncident {
  severity: "high";
  code: "LOCALIZATION_MESSAGE_FAILURE";
  locale: AppLocale;
  fallbackLocale: AppLocale;
  route: string;
  key: string;
  catalogVersion: string;
  errorCode?: string;
}

/**
 * Structured production boundary for localization defects. The payload excludes
 * rendered values and user content so it is safe to forward to observability.
 */
export function reportLocalizationIncident(
  incident: Omit<LocalizationIncident, "severity" | "code" | "catalogVersion">,
) {
  console.error("[localization-incident]", {
    severity: "high",
    code: "LOCALIZATION_MESSAGE_FAILURE",
    catalogVersion,
    ...incident,
  } satisfies LocalizationIncident);
}
