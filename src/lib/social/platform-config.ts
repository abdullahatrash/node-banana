/**
 * Per-platform server OAuth credential configuration.
 *
 * Some social platforms (X, LinkedIn, Meta, TikTok, YouTube/Google, Reddit,
 * Pinterest) require a developer app registered by the operator, whose
 * client id/secret are supplied via environment variables (see
 * .env.example). Others (Bluesky, Mastodon) never need server-side
 * credentials — the user supplies their own at connect time.
 *
 * This module only ever checks *presence* of the required env vars. It
 * never reads, logs, or exposes their values — callers get a boolean.
 */
import type { SocialPlatform } from "@/lib/db/schema";

/**
 * Env var names required for each platform's server-side OAuth app
 * credentials. Instagram, Facebook, and Threads share a single Meta app
 * (META_APP_ID / META_APP_SECRET). Platforms absent from this map (bluesky,
 * mastodon) don't require any server credentials and are always considered
 * configured.
 */
const PLATFORM_REQUIRED_ENV_VARS: Partial<
  Record<SocialPlatform, readonly string[]>
> = {
  x: ["X_API_KEY", "X_API_SECRET"],
  linkedin: ["LINKEDIN_CLIENT_ID", "LINKEDIN_CLIENT_SECRET"],
  instagram: ["META_APP_ID", "META_APP_SECRET"],
  facebook: ["META_APP_ID", "META_APP_SECRET"],
  threads: ["META_APP_ID", "META_APP_SECRET"],
  tiktok: ["TIKTOK_CLIENT_KEY", "TIKTOK_CLIENT_SECRET"],
  youtube: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
  reddit: ["REDDIT_CLIENT_ID", "REDDIT_CLIENT_SECRET"],
  pinterest: ["PINTEREST_CLIENT_ID", "PINTEREST_CLIENT_SECRET"],
};

/**
 * Whether a platform's server-side OAuth app credentials are configured.
 * Returns true for platforms that don't require any (bluesky, mastodon).
 */
export function isPlatformConfigured(platform: SocialPlatform): boolean {
  const requiredVars = PLATFORM_REQUIRED_ENV_VARS[platform];
  if (!requiredVars) return true;
  return requiredVars.every((name) => Boolean(process.env[name]?.trim()));
}

/**
 * List the env var names required for a platform (for error messages /
 * diagnostics). Never returns values — only the var names.
 */
export function getRequiredEnvVarNames(
  platform: SocialPlatform,
): readonly string[] {
  return PLATFORM_REQUIRED_ENV_VARS[platform] ?? [];
}
