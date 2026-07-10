import type { ByokProvider } from "./providers";
import { BYOK_PROVIDER_LABELS } from "./providers";

export type ProviderKeyValidationResult =
  | { ok: true }
  | { ok: false; error: string };

/** Generous but bounded — this is a cheap liveness check, not a real request. */
const VALIDATION_TIMEOUT_MS = 8000;

interface ProbeConfig {
  url: string;
  headers: Record<string, string>;
}

function buildProbe(provider: ByokProvider, rawKey: string): ProbeConfig {
  switch (provider) {
    case "gemini":
      // Cheapest authenticated GET for a Gemini key: list models. Google's
      // GenAI SDK also authenticates image/LLM calls via this `key` query
      // param, so a 200 here is a faithful proxy for "the key works".
      return {
        url: `https://generativelanguage.googleapis.com/v1beta/models?pageSize=1&key=${encodeURIComponent(rawKey)}`,
        headers: {},
      };
    case "openai":
      // GET /v1/models is free (no token cost) and requires a valid key.
      return {
        url: "https://api.openai.com/v1/models",
        headers: { Authorization: `Bearer ${rawKey}` },
      };
    case "anthropic":
      // GET /v1/models mirrors the auth headers generateWithAnthropic()
      // already sends in src/app/api/llm/route.ts.
      return {
        url: "https://api.anthropic.com/v1/models",
        headers: {
          "x-api-key": rawKey,
          "anthropic-version": "2023-06-01",
        },
      };
    case "kie":
      // https://docs.kie.ai/common-api/get-account-credits — the cheapest
      // authenticated GET Kie exposes (no task is created).
      return {
        url: "https://api.kie.ai/api/v1/chat/credit",
        headers: { Authorization: `Bearer ${rawKey}` },
      };
    case "fal":
      // fal's own auth docs recommend GET /v1/models (API scope, not Admin)
      // as the lightweight way to confirm a key is valid and active.
      return {
        url: "https://api.fal.ai/v1/models?limit=1",
        headers: { Authorization: `Key ${rawKey}` },
      };
    case "replicate":
      // GET /v1/account returns the authenticated account — no run created.
      return {
        url: "https://api.replicate.com/v1/account",
        headers: { Authorization: `Bearer ${rawKey}` },
      };
    case "wavespeed":
      // GET /api/v3/balance — reads account balance, no generation started.
      return {
        url: "https://api.wavespeed.ai/api/v3/balance",
        headers: { Authorization: `Bearer ${rawKey}` },
      };
  }
}

/**
 * Best-effort extraction of a human-readable error message from a provider's
 * JSON error body. Providers disagree on shape (`error.message`, `msg`,
 * `message`, `detail`, ...) so this tries the common ones in order and falls
 * back to a generic HTTP-status message.
 */
function extractErrorMessage(body: unknown, status: number): string {
  if (body && typeof body === "object") {
    const record = body as Record<string, unknown>;

    const nestedError = record.error;
    if (nestedError && typeof nestedError === "object") {
      const message = (nestedError as Record<string, unknown>).message;
      if (typeof message === "string" && message) return message;
    }
    if (typeof nestedError === "string" && nestedError) return nestedError;

    for (const field of ["msg", "message", "detail"]) {
      const value = record[field];
      if (typeof value === "string" && value) return value;
    }
  }

  return `Request failed with status ${status}.`;
}

/**
 * Validate a BYOK provider key with a single cheap, authenticated GET call —
 * the same "list models" / "account" style endpoint the app's own generation
 * code would use to authenticate, so a pass here means the key genuinely
 * works for real generation calls.
 */
export async function validateProviderKey(
  provider: ByokProvider,
  rawKey: string,
): Promise<ProviderKeyValidationResult> {
  const trimmed = rawKey.trim();
  if (!trimmed) {
    return { ok: false, error: "An API key is required." };
  }

  const probe = buildProbe(provider, trimmed);
  const label = BYOK_PROVIDER_LABELS[provider];

  let response: Response;
  try {
    response = await fetch(probe.url, {
      method: "GET",
      headers: probe.headers,
      signal: AbortSignal.timeout(VALIDATION_TIMEOUT_MS),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      error: `Could not reach ${label} to validate the key: ${message}`,
    };
  }

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    return { ok: false, error: extractErrorMessage(body, response.status) };
  }

  return { ok: true };
}
