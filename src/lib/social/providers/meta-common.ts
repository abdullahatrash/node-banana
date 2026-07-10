/**
 * Shared Meta (Facebook/Instagram) Graph API helpers.
 *
 * Both the Instagram and Facebook providers use the same OAuth flow (Facebook
 * Login) and the same token-exchange pattern. Centralising these here avoids
 * duplication and makes future version bumps (v20 → v21) a one-line change.
 */

import type { SocialProviderError, SocialErrorType } from "@/lib/social/provider-interface";

/** Graph API version used across all Meta calls. */
export const META_API_VERSION = "v20.0";

/** Base URL for all Graph API calls. */
export const GRAPH_BASE = `https://graph.facebook.com/${META_API_VERSION}`;

// ---------------------------------------------------------------------------
// Environment helpers
// ---------------------------------------------------------------------------

export function getMetaAppId(): string {
  const id = process.env.META_APP_ID;
  if (!id) throw new Error("META_APP_ID environment variable is not set.");
  return id;
}

export function getMetaAppSecret(): string {
  const secret = process.env.META_APP_SECRET;
  if (!secret) throw new Error("META_APP_SECRET environment variable is not set.");
  return secret;
}

// ---------------------------------------------------------------------------
// Token exchange
// ---------------------------------------------------------------------------

export interface ShortToLongTokenResult {
  access_token: string;
  token_type: string;
  expires_in?: number;
}

/**
 * Exchange a short-lived user access token for a long-lived one (~60 days).
 * This is the second step of the Facebook OAuth code exchange.
 */
export async function exchangeForLongLivedToken(
  shortLivedToken: string,
): Promise<ShortToLongTokenResult> {
  const url =
    `${GRAPH_BASE}/oauth/access_token` +
    `?grant_type=fb_exchange_token` +
    `&client_id=${getMetaAppId()}` +
    `&client_secret=${getMetaAppSecret()}` +
    `&fb_exchange_token=${encodeURIComponent(shortLivedToken)}`;

  const response = await fetch(url);
  const data = (await response.json()) as ShortToLongTokenResult & {
    error?: { message: string; code: number };
  };

  if (data.error) {
    throw new MetaApiError(
      data.error.message,
      data.error.code,
      JSON.stringify(data),
    );
  }

  return data;
}

/**
 * Exchange an authorization code for a short-lived access token.
 * This is the first step of the Facebook OAuth code exchange.
 */
export async function exchangeCodeForToken(
  code: string,
  redirectUri: string,
): Promise<{ access_token: string; token_type: string; expires_in?: number }> {
  const url =
    `${GRAPH_BASE}/oauth/access_token` +
    `?client_id=${getMetaAppId()}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&client_secret=${getMetaAppSecret()}` +
    `&code=${encodeURIComponent(code)}`;

  const response = await fetch(url);
  const data = (await response.json()) as {
    access_token: string;
    token_type: string;
    expires_in?: number;
    error?: { message: string; code: number };
  };

  if (data.error) {
    throw new MetaApiError(
      data.error.message,
      data.error.code,
      JSON.stringify(data),
    );
  }

  return data;
}

// ---------------------------------------------------------------------------
// Permission verification
// ---------------------------------------------------------------------------

/**
 * Fetch granted permissions for a user token and verify all required scopes
 * are present. Throws MetaPermissionError when any scope is missing.
 */
export async function verifyGrantedScopes(
  accessToken: string,
  requiredScopes: string[],
): Promise<void> {
  const url = `${GRAPH_BASE}/me/permissions?access_token=${encodeURIComponent(accessToken)}`;
  const response = await fetch(url);
  const data = (await response.json()) as {
    data?: Array<{ permission: string; status: string }>;
    error?: { message: string; code: number };
  };

  if (data.error) {
    throw new MetaApiError(data.error.message, data.error.code, JSON.stringify(data));
  }

  const granted = new Set(
    (data.data ?? [])
      .filter((d) => d.status === "granted")
      .map((d) => d.permission),
  );

  const missing = requiredScopes.filter((s) => !granted.has(s));
  if (missing.length > 0) {
    throw new MetaPermissionError(missing);
  }
}

// ---------------------------------------------------------------------------
// Error classification
// ---------------------------------------------------------------------------

/**
 * Build the match string that {@link classifyMetaError} pattern-matches
 * against, from a thrown error.
 *
 * A real {@link MetaApiError} carries the numeric Graph API error code on its
 * structured `.code` field and the full platform error body (including
 * `error_subcode`, `type` and `message`) on `.rawBody` — the numeric code is
 * NEVER folded into the human-readable `.message`. The previous behaviour
 * (`JSON.stringify({ message: error.message })`) therefore left every
 * numeric-code branch below unreachable, so permanent content-policy failures
 * mis-classified as transient "retry" and would retry forever. We fold every
 * structured field into the match string instead.
 *
 * The numeric `code` is emitted with a trailing comma so the exact-match
 * patterns `"190,"` / `"490,"` in {@link classifyMetaError} match regardless
 * of how the platform ordered its JSON fields.
 */
export function metaErrorToClassifierBody(error: unknown): string {
  if (isMetaApiError(error)) {
    const parts: string[] = [];
    if (error.code !== undefined && error.code !== null) {
      parts.push(`${error.code},`);
    }
    if (error.message) parts.push(error.message);
    if (error.rawBody) parts.push(error.rawBody);
    return parts.join(" ");
  }
  if (error instanceof Error) {
    return JSON.stringify({ message: error.message });
  }
  if (typeof error === "string") {
    return error;
  }
  return JSON.stringify(error);
}

/**
 * Duck-typed MetaApiError check. Uses `.name` rather than `instanceof` so it
 * stays correct when the class is loaded from a different module instance
 * (e.g. after `vi.resetModules()` in tests, or across bundle boundaries).
 */
function isMetaApiError(error: unknown): error is MetaApiError {
  return (
    error instanceof Error &&
    error.name === "MetaApiError" &&
    ("code" in error || "rawBody" in error)
  );
}

/**
 * Classify a Meta Graph API error body string into a SocialProviderError.
 *
 * This runs through the same error codes that Postiz's Instagram/Facebook
 * providers handle, adapted to our SocialProviderError type.
 *
 * @param body - The match string produced by {@link metaErrorToClassifierBody}
 *   (or any string containing the platform error tokens).
 * @returns A classified SocialProviderError, or undefined if unknown.
 */
export function classifyMetaError(body: string): SocialProviderError | undefined {
  // ------------------------------------------------------------------
  // Token / re-auth errors
  // ------------------------------------------------------------------
  if (
    body.includes("Error validating access token") ||
    body.includes("REVOKED_ACCESS_TOKEN") ||
    body.includes("session has been invalidated") ||
    body.includes("490,")
  ) {
    return err("refresh-token", "Please re-authenticate your account.");
  }

  if (body.includes("the user is not an instagram business")) {
    return err(
      "refresh-token",
      "Your Instagram account is not a business account. Convert it in the Instagram app, then reconnect.",
    );
  }

  if (body.includes("Not enough permissions to post") || body.includes("190,")) {
    return err(
      "refresh-token",
      "Missing required permissions. Please re-add the account and allow all requested permissions.",
    );
  }

  if (body.includes("1404078")) {
    return err(
      "refresh-token",
      "Page publishing authorization required. Please re-authenticate.",
    );
  }

  // ------------------------------------------------------------------
  // Transient / retry errors
  // ------------------------------------------------------------------
  if (body.includes("An unknown error occurred")) {
    return err("retry", "An unknown error occurred. Please try again later.");
  }

  if (body.includes("1363047") || body.includes("1609010")) {
    return err("retry", "Facebook service temporarily unavailable. Please try again.");
  }

  // ------------------------------------------------------------------
  // Content / bad-body errors — Instagram media
  // ------------------------------------------------------------------
  if (body.includes("2207081")) {
    return err("bad-body", "This account doesn't support Trial Reels.");
  }

  if (body.includes("2207050")) {
    return err("bad-body", "Instagram user is restricted.");
  }

  if (body.includes("2207003")) {
    return err("bad-body", "Timeout downloading media. Please try again.");
  }

  if (body.includes("2207020")) {
    return err("bad-body", "Media expired. Please upload again.");
  }

  if (body.includes("2207032")) {
    return err("bad-body", "Failed to create media. Please try again.");
  }

  if (body.includes("2207053")) {
    return err("bad-body", "Unknown upload error. Please try again.");
  }

  if (body.includes("2207052")) {
    return err("bad-body", "Media fetch failed. Please try again.");
  }

  if (body.includes("2207057")) {
    return err("bad-body", "Invalid thumbnail offset for video.");
  }

  if (body.includes("2207026")) {
    return err("bad-body", "Unsupported video format.");
  }

  if (body.includes("2207023")) {
    return err("bad-body", "Unknown media type.");
  }

  if (body.includes("2207006")) {
    return err("bad-body", "Media not found. Please upload again.");
  }

  if (body.includes("2207008")) {
    return err("bad-body", "Media builder expired. Please try again.");
  }

  if (body.includes("2207028")) {
    return err("bad-body", "Carousel validation failed.");
  }

  if (body.includes("2207010")) {
    return err("bad-body", "Caption is too long.");
  }

  if (body.includes("2207035")) {
    return err("bad-body", "Product tag positions not supported for videos.");
  }

  if (body.includes("2207036")) {
    return err("bad-body", "Product tag positions required for photos.");
  }

  if (body.includes("2207037")) {
    return err("bad-body", "Product tag validation failed.");
  }

  if (body.includes("2207040")) {
    return err("bad-body", "Too many product tags.");
  }

  if (body.includes("2207004")) {
    return err("bad-body", "Image is too large.");
  }

  if (body.includes("2207005")) {
    return err("bad-body", "Unsupported image format.");
  }

  if (body.includes("2207009") || body.includes("36003")) {
    return err(
      "bad-body",
      "Aspect ratio not supported. Must be between 4:5 and 1.91:1.",
    );
  }

  if (body.includes("36001")) {
    return err("bad-body", "Invalid Instagram image resolution. Max: 1920×1080 px.");
  }

  if (body.includes("2207051")) {
    return err("bad-body", "Instagram blocked your request.");
  }

  if (body.includes("2207001")) {
    return err(
      "bad-body",
      "Instagram detected spam. Please try again with different content.",
    );
  }

  if (body.includes("2207027") || body.includes("2207042")) {
    return err(
      "bad-body",
      "You have reached the maximum of 25 posts per day for your account.",
    );
  }

  if (body.includes("Page request limit reached")) {
    return err("bad-body", "Page posting limit reached for today. Try again tomorrow.");
  }

  if (body.includes("param collaborators is not allowed")) {
    return err("bad-body", "Collaborators are not allowed for carousel posts.");
  }

  // ------------------------------------------------------------------
  // Content / bad-body errors — Facebook page
  // ------------------------------------------------------------------
  if (body.includes("1366046")) {
    return err("bad-body", "Photos must be smaller than 4 MB and saved as JPG or PNG.");
  }

  if (body.includes("1390008")) {
    return err("bad-body", "You are posting too fast. Please slow down.");
  }

  if (body.includes("1346003")) {
    return err("bad-body", "Content flagged as abusive by Facebook.");
  }

  if (body.includes("1404006")) {
    return err(
      "bad-body",
      "A security check is required by Facebook to proceed.",
    );
  }

  if (body.includes("1404102")) {
    return err("bad-body", "Content violates Facebook Community Standards.");
  }

  if (body.includes("1404112")) {
    return err(
      "bad-body",
      "Your account has limited access for a few days for security reasons.",
    );
  }

  if (body.includes("1609008")) {
    return err("bad-body", "Cannot post Facebook.com links.");
  }

  if (body.includes("2061006")) {
    return err("bad-body", "Invalid URL format in post content.");
  }

  if (body.includes("1349125")) {
    return err("bad-body", "Invalid content format.");
  }

  if (body.includes("Name parameter too long")) {
    return err("bad-body", "Post content is too long.");
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function err(type: SocialErrorType, message: string): SocialProviderError {
  return { type, message };
}

// ---------------------------------------------------------------------------
// Custom error types
// ---------------------------------------------------------------------------

export class MetaApiError extends Error {
  constructor(
    message: string,
    public readonly code?: number,
    public readonly rawBody?: string,
  ) {
    super(message);
    this.name = "MetaApiError";
  }
}

export class MetaPermissionError extends Error {
  constructor(public readonly missingScopes: string[]) {
    super(
      `Missing required Meta permissions: ${missingScopes.join(", ")}. ` +
        "Please re-authenticate and grant all requested permissions.",
    );
    this.name = "MetaPermissionError";
  }
}

/**
 * Generate a random alphanumeric state string for OAuth CSRF protection.
 */
export function makeOAuthState(length = 16): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let state = "";
  for (let i = 0; i < length; i++) {
    state += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return state;
}
