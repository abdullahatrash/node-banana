/**
 * Runtime bootstrap for social providers.
 *
 * Import this module from server entrypoints (API routes/workflows) before
 * using provider-registry so adapters are registered deterministically.
 */
import "@/lib/social/providers";
import {
  isProviderRegistered,
  listProviders,
  registerProvider,
} from "@/lib/social/provider-registry";
import type { SocialProviderAdapter } from "@/lib/social/provider-interface";

export const socialProvidersBootstrapped = true;

let bootstrapPromise: Promise<SocialProviderAdapter[]> | null = null;

async function loadBuiltInProviders(): Promise<SocialProviderAdapter[]> {
  const [
    linkedInModule,
    xModule,
    instagramModule,
    facebookModule,
    tikTokModule,
    youTubeModule,
    redditModule,
    threadsModule,
    pinterestModule,
  ] = await Promise.all([
    import("@/lib/social/providers/linkedin"),
    import("@/lib/social/providers/x"),
    import("@/lib/social/providers/instagram"),
    import("@/lib/social/providers/facebook"),
    import("@/lib/social/providers/tiktok"),
    import("@/lib/social/providers/youtube"),
    import("@/lib/social/providers/reddit"),
    import("@/lib/social/providers/threads"),
    import("@/lib/social/providers/pinterest"),
  ]);

  return [
    linkedInModule.linkedInProvider,
    xModule.xProvider,
    instagramModule.instagramProvider,
    facebookModule.facebookProvider,
    tikTokModule.tikTokProvider,
    youTubeModule.youTubeProvider,
    redditModule.redditProvider,
    threadsModule.threadsProvider,
    pinterestModule.pinterestProvider,
  ];
}

export async function ensureSocialProvidersBootstrapped(): Promise<void> {
  if (listProviders().length > 0) {
    return;
  }

  bootstrapPromise ??= loadBuiltInProviders().finally(() => {
    bootstrapPromise = null;
  });

  const providers = await bootstrapPromise;
  for (const provider of providers) {
    if (!isProviderRegistered(provider.identifier)) {
      registerProvider(provider);
    }
  }
}
