export type CopilotProvider = "anthropic" | "google" | "openai";

export type ResolveCopilotModelResult =
  | { ok: true; provider: CopilotProvider; modelId: string; apiKey: string }
  | { ok: false; error: string };

export const DEFAULT_COPILOT_MODEL_ID = "claude-sonnet-4-6";

/** BYOK header carrying each provider's user-supplied key. */
const PROVIDER_HEADER: Record<CopilotProvider, string> = {
  anthropic: "X-Anthropic-API-Key",
  google: "X-Gemini-API-Key",
  openai: "X-OpenAI-API-Key",
};

const PROVIDER_LABEL: Record<CopilotProvider, string> = {
  anthropic: "Anthropic",
  google: "Google",
  openai: "OpenAI",
};

/** Models the copilot may run, mapped to the provider whose key they need. */
const MODEL_PROVIDER: Record<string, CopilotProvider> = {
  "claude-sonnet-4-6": "anthropic",
  "claude-haiku-4.5": "anthropic",
  "claude-opus-4.6": "anthropic",
  "gemini-3-pro-preview": "google",
  "gemini-3.1-pro-preview": "google",
  "gemini-3-flash-preview": "google",
  "gpt-4.1-mini": "openai",
  "gpt-4.1-nano": "openai",
};

/**
 * Resolve which model + key the copilot should run with, from BYOK request
 * headers. Defaults to Claude Sonnet 4.6. There is no environment-variable
 * fallback: if the chosen model's provider key is absent, the caller must
 * prompt the user to add it in Settings (cost stays on the user).
 */
export function resolveCopilotModel(
  headers: Headers,
  requestedModel?: string,
): ResolveCopilotModelResult {
  const modelId = requestedModel ?? DEFAULT_COPILOT_MODEL_ID;
  const provider = MODEL_PROVIDER[modelId];

  if (!provider) {
    return {
      ok: false,
      error: `Unknown copilot model "${modelId}". Choose a supported model in Settings.`,
    };
  }

  const apiKey = headers.get(PROVIDER_HEADER[provider]);
  if (!apiKey) {
    return {
      ok: false,
      error: `Add your ${PROVIDER_LABEL[provider]} API key in Settings to use the copilot.`,
    };
  }

  return { ok: true, provider, modelId, apiKey };
}
