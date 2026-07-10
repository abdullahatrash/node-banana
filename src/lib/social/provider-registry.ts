import type { SocialPlatform } from "@/lib/db/schema";
import type {
  ProviderCapabilities,
  SocialProviderAdapter,
} from "@/lib/social/provider-interface";
import { isPlatformConfigured } from "@/lib/social/platform-config";

const registry = new Map<string, SocialProviderAdapter>();

/**
 * Register a social provider adapter.
 * Typically called at module load time from each provider file.
 */
export function registerProvider(provider: SocialProviderAdapter): void {
  if (registry.has(provider.identifier)) {
    throw new Error(
      `Social provider "${provider.identifier}" is already registered.`,
    );
  }
  registry.set(provider.identifier, provider);
}

/**
 * Get a registered provider by platform identifier.
 * Throws if the provider is not registered.
 */
export function getProvider(platform: string): SocialProviderAdapter {
  const provider = registry.get(platform);
  if (!provider) {
    throw new SocialProviderNotFoundError(platform);
  }
  return provider;
}

/**
 * List all registered providers.
 */
export function listProviders(): SocialProviderAdapter[] {
  return Array.from(registry.values());
}

/**
 * List capabilities of all registered providers (for API responses).
 * Each entry is annotated with `configured`, reflecting whether the
 * platform's required server OAuth credentials are present in the
 * environment. Never exposes credential values — only a boolean.
 */
export function listProviderCapabilities(): ProviderCapabilities[] {
  return listProviders().map((provider) => ({
    ...provider.getCapabilities(),
    configured: isPlatformConfigured(provider.identifier),
  }));
}

/**
 * Check if a platform identifier is valid (registered).
 */
export function isProviderRegistered(platform: string): boolean {
  return registry.has(platform);
}

/**
 * Validate that a string is a known platform and has a registered provider.
 * Returns the typed SocialPlatform if valid, throws otherwise.
 */
export function validatePlatform(platform: string): SocialPlatform {
  if (!registry.has(platform)) {
    throw new SocialProviderNotFoundError(platform);
  }
  return platform as SocialPlatform;
}

/**
 * Clear the registry (for testing only).
 */
export function clearRegistry(): void {
  registry.clear();
}

export class SocialProviderNotFoundError extends Error {
  platform: string;

  constructor(platform: string) {
    super(
      `Social provider "${platform}" is not available. Registered providers: ${
        Array.from(registry.keys()).join(", ") || "(none)"
      }`,
    );
    this.name = "SocialProviderNotFoundError";
    this.platform = platform;
  }
}
