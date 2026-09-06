import { createTranslator } from "next-intl";
import { catalogs } from "./catalog";
import type { AppLocale } from "./config";

export type LocalizedErrorCode =
  | "REQUIRED"
  | "INVALID"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "CAPABILITY_UNAVAILABLE"
  | "PROVIDER_UNAVAILABLE"
  | "UNKNOWN";

const errorMessageKeys = {
  REQUIRED: "required",
  INVALID: "invalid",
  UNAUTHENTICATED: "unauthenticated",
  FORBIDDEN: "forbidden",
  CONFLICT: "conflict",
  RATE_LIMITED: "rateLimited",
  CAPABILITY_UNAVAILABLE: "capabilityUnavailable",
  PROVIDER_UNAVAILABLE: "providerUnavailable",
  UNKNOWN: "unknown",
} as const satisfies Record<LocalizedErrorCode, keyof typeof catalogs.en.errors>;

const aliases: Record<string, LocalizedErrorCode> = {
  VALIDATION_FAILED: "INVALID",
  ONBOARDING_VALIDATION_FAILED: "INVALID",
  AGENT_AUTHENTICATION_FAILED: "UNAUTHENTICATED",
  ONBOARDING_UNAUTHORIZED: "UNAUTHENTICATED",
  CAPABILITY_NOT_AUTHORIZED: "FORBIDDEN",
  HUMAN_CAPABILITY_NOT_AUTHORIZED: "FORBIDDEN",
  AUTHORIZATION_ADMISSION_UNAVAILABLE: "CAPABILITY_UNAVAILABLE",
  CAPABILITY_NOT_FOUND: "CAPABILITY_UNAVAILABLE",
  ARTIFACT_QUOTA_EXCEEDED: "RATE_LIMITED",
  STEP_EXECUTION_FAILED: "PROVIDER_UNAVAILABLE",
};

export function canonicalizeErrorCode(code: string | null | undefined): LocalizedErrorCode {
  if (!code) return "UNKNOWN";
  if (code in errorMessageKeys) return code as LocalizedErrorCode;
  return aliases[code] ?? "UNKNOWN";
}

export function getLocalizedErrorMessage(locale: AppLocale, code: string | null | undefined) {
  const t = createTranslator({ locale, messages: catalogs[locale], namespace: "errors" });
  return t(errorMessageKeys[canonicalizeErrorCode(code)]);
}
