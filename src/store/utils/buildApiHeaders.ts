/**
 * API Header Builder Utilities
 *
 * Centralizes the duplicated header-building logic for API calls
 * across executeWorkflow and regenerateNode.
 */

import { isCloudMode } from "@/lib/storage";
import { getActiveWorkspaceId } from "@/lib/studio/client";
import { ProviderType, ProviderSettings, LLMProvider } from "@/types";

/**
 * Header name mapping for each provider
 */
const PROVIDER_HEADER_MAP: Record<ProviderType, string> = {
  gemini: "X-Gemini-API-Key",
  replicate: "X-Replicate-API-Key",
  fal: "X-Fal-API-Key",
  kie: "X-Kie-Key",
  wavespeed: "X-WaveSpeed-Key",
  openai: "X-OpenAI-API-Key",
  anthropic: "X-Anthropic-API-Key",
};

export function addWorkspaceHeader(headers: Record<string, string>): void {
  if (isCloudMode()) {
    const workspaceId = getActiveWorkspaceId();
    if (workspaceId) {
      headers["x-workspace-id"] = workspaceId;
    }
  }
}

/**
 * Build headers for image/video generation API calls.
 * Adds the appropriate API key header based on the provider.
 */
export function buildGenerateHeaders(
  provider: ProviderType | string,
  providerSettings: ProviderSettings
): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  const providerKey = provider as ProviderType;
  const headerName = PROVIDER_HEADER_MAP[providerKey];
  if (headerName) {
    const config = providerSettings.providers[providerKey];
    if (config?.apiKey) {
      headers[headerName] = config.apiKey;
    }
  }

  addWorkspaceHeader(headers);
  return headers;
}

/**
 * Build headers for LLM API calls.
 * Maps LLM provider names ("google", "openai") to their API key headers.
 */
export function buildLlmHeaders(
  llmProvider: LLMProvider | string,
  providerSettings: ProviderSettings
): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (llmProvider === "google") {
    const geminiConfig = providerSettings.providers.gemini;
    if (geminiConfig?.apiKey) {
      headers["X-Gemini-API-Key"] = geminiConfig.apiKey;
    }
  } else if (llmProvider === "openai") {
    const openaiConfig = providerSettings.providers.openai;
    if (openaiConfig?.apiKey) {
      headers["X-OpenAI-API-Key"] = openaiConfig.apiKey;
    }
  } else if (llmProvider === "anthropic") {
    const anthropicConfig = providerSettings.providers.anthropic;
    if (anthropicConfig?.apiKey) {
      headers["X-Anthropic-API-Key"] = anthropicConfig.apiKey;
    }
  }

  addWorkspaceHeader(headers);
  return headers;
}

/**
 * Build headers for the Gemini-only chat/quickstart API calls.
 * Adds the X-Gemini-API-Key override (if the user configured one) plus the
 * workspace header (cloud mode only) — the same BYOK resolution surface as
 * buildLlmHeaders, scoped to routes that always call Gemini.
 */
export function buildGeminiOnlyHeaders(
  geminiApiKey?: string | null
): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (geminiApiKey) {
    headers["X-Gemini-API-Key"] = geminiApiKey;
  }

  addWorkspaceHeader(headers);
  return headers;
}
