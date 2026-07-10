/**
 * The AI providers a workspace can store a BYOK key for. Kept as the single
 * source of truth so the DB enum, validation, repository, routes, and UI all
 * derive from one list.
 */
export const BYOK_PROVIDERS = [
  "gemini",
  "openai",
  "anthropic",
  "kie",
  "fal",
  "replicate",
  "wavespeed",
] as const;

export type ByokProvider = (typeof BYOK_PROVIDERS)[number];

export const BYOK_PROVIDER_LABELS: Record<ByokProvider, string> = {
  gemini: "Google Gemini",
  openai: "OpenAI",
  anthropic: "Anthropic",
  kie: "Kie.ai",
  fal: "fal.ai",
  replicate: "Replicate",
  wavespeed: "WaveSpeed",
};

export function isByokProvider(value: string): value is ByokProvider {
  return (BYOK_PROVIDERS as readonly string[]).includes(value);
}
