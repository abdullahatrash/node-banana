/**
 * BYOK inference-key resolution — the single seam every product inference path
 * (generate, LLM) uses to obtain a provider API key.
 *
 * Resolution order:
 *   1. Request-header override (e.g. `X-Gemini-API-Key`) — ad-hoc / agent use.
 *   2. Workspace vault (`resolveProviderKey`) — the workspace's stored key.
 *   3. A typed {@link InferenceKeyError} — never a server-env fallback.
 *
 * There is deliberately NO `process.env.<PROVIDER>_KEY` tier: the business does
 * not provide or resell inference, so a product request that resolves no BYOK
 * key must fail with a clear, user-actionable error — never silently bill the
 * operator's own key.
 *
 * The error is a structured shape (`code`/`provider`/`message`/`remedy`) that
 * routes translate into a 4xx JSON body naming the provider and pointing to
 * Settings → Provider Keys. It never surfaces as a 500 and never leaks the
 * server env var name.
 */

import { BYOK_PROVIDER_LABELS, type ByokProvider } from "./providers";
import { resolveProviderKey } from "./repository";

/** Where a user adds a workspace provider key in the app. */
const SETTINGS_LOCATION = "Settings → Provider Keys";

/** Serialisable shape a route can spread straight into a JSON error body. */
export interface ByokKeyMissingBody {
  code: "byok_key_missing";
  provider: ByokProvider;
  message: string;
  remedy: string;
}

/**
 * Thrown when no BYOK key can be resolved for a provider. Carries a structured,
 * user-facing shape; routes catch it and return a 4xx (never a 500). The
 * message intentionally names the human-readable provider and the in-app
 * location, and never references the server environment.
 */
export class InferenceKeyError extends Error {
  readonly code = "byok_key_missing" as const;
  readonly provider: ByokProvider;
  readonly remedy: string;

  constructor(provider: ByokProvider) {
    const label = BYOK_PROVIDER_LABELS[provider] ?? provider;
    super(
      `No ${label} API key is configured for this workspace. ` +
        `Add one in ${SETTINGS_LOCATION}.`,
    );
    this.name = "InferenceKeyError";
    this.provider = provider;
    this.remedy = `Add a ${label} key in ${SETTINGS_LOCATION}.`;
    // Restore prototype chain for `instanceof` across transpile targets.
    Object.setPrototypeOf(this, InferenceKeyError.prototype);
  }

  toJSON(): ByokKeyMissingBody {
    return {
      code: this.code,
      provider: this.provider,
      message: this.message,
      remedy: this.remedy,
    };
  }
}

export function isInferenceKeyError(
  value: unknown,
): value is InferenceKeyError {
  return value instanceof InferenceKeyError;
}

export interface ResolveInferenceKeyInput {
  /** Raw request-header value (e.g. `request.headers.get("X-Gemini-API-Key")`). */
  headerKey?: string | null;
  /** Workspace context from the `x-workspace-id` header; null when absent. */
  workspaceId?: string | null;
  provider: ByokProvider;
}

/**
 * Resolve a usable provider key or throw {@link InferenceKeyError}.
 *
 * When `workspaceId` is absent, only the header tier applies (no vault lookup):
 * a headerless request without workspace context fails with the typed error —
 * it never falls back to a server env key.
 */
export async function resolveInferenceKey(
  input: ResolveInferenceKeyInput,
): Promise<string> {
  const key = await resolveInferenceKeyOptional(input);
  if (key) return key;
  throw new InferenceKeyError(input.provider);
}

/**
 * Same resolution order as {@link resolveInferenceKey}, but returns `null`
 * instead of throwing when no key is found. For providers that intentionally
 * support anonymous (rate-limited) use — e.g. fal.ai — where a missing key is
 * a valid state rather than an error. Still never consults the server env.
 */
export async function resolveInferenceKeyOptional(
  input: ResolveInferenceKeyInput,
): Promise<string | null> {
  const { headerKey, workspaceId, provider } = input;

  const trimmedHeader = headerKey?.trim();
  if (trimmedHeader) return trimmedHeader;

  if (workspaceId) {
    const vaultKey = await resolveProviderKey(workspaceId, provider);
    if (vaultKey) return vaultKey;
  }

  return null;
}
