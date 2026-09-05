import { StudioApiError } from "@/lib/studio/client";

export type ClientErrorMessageKey =
  | "unauthenticated"
  | "forbidden"
  | "conflict"
  | "rateLimited"
  | "capabilityUnavailable"
  | "providerUnavailable";

export interface ClientErrorPresentation {
  message: string;
  technicalReference: string | null;
}

type ErrorTranslator = (key: ClientErrorMessageKey) => string;

const SAFE_REFERENCE_PART = /^[A-Za-z][A-Za-z0-9_.:-]{0,127}$/u;
const CAPABILITY_CODES = new Set([
  "platform_not_configured",
  "quota_exceeded",
  "CAPABILITY_NOT_FOUND",
  "CAPABILITY_VERSION_RETIRED",
]);

function safeReferencePart(value: string | null): string | null {
  if (!value || !SAFE_REFERENCE_PART.test(value)) return null;
  return value;
}

export function presentClientError(
  cause: unknown,
  fallbackMessage: string,
  translate: ErrorTranslator,
): ClientErrorPresentation {
  if (!(cause instanceof StudioApiError)) {
    return { message: fallbackMessage, technicalReference: null };
  }

  const code = safeReferencePart(cause.code);
  const trace = safeReferencePart(cause.operatorTraceRef);
  const technicalReference = [
    code,
    Number.isInteger(cause.status) ? `HTTP:${cause.status}` : null,
    trace ? `TRACE:${trace}` : null,
  ].filter(Boolean).join(" · ") || null;

  if (code && CAPABILITY_CODES.has(code)) {
    return { message: translate("capabilityUnavailable"), technicalReference };
  }
  if (cause.status === 401) {
    return { message: translate("unauthenticated"), technicalReference };
  }
  if (cause.status === 403) {
    return { message: translate("forbidden"), technicalReference };
  }
  if (cause.status === 409) {
    return { message: translate("conflict"), technicalReference };
  }
  if (cause.status === 429) {
    return { message: translate("rateLimited"), technicalReference };
  }
  if (cause.status === 404) {
    return { message: translate("capabilityUnavailable"), technicalReference };
  }
  if (cause.status >= 500) {
    return { message: translate("providerUnavailable"), technicalReference };
  }
  return { message: fallbackMessage, technicalReference };
}
