/**
 * X (Twitter) provider adapter.
 *
 * Uses OAuth 1.0a via the `twitter-api-v2` package.
 *
 * Auth flow:
 *   1. generateAuthUrl — calls TwitterApi.generateAuthLink(), stores
 *      oauth_token + oauth_token_secret as `codeVerifier` ("token:secret").
 *   2. authenticate — splits codeVerifier, constructs a TwitterApi client,
 *      calls client.login(oauthVerifier), returns permanent tokens.
 *   3. refreshToken — no-op (OAuth 1.0a tokens do not expire).
 *
 * Publishing:
 *   - Images are downloaded from their URL, resized to max 1000px wide via
 *     sharp, then uploaded via client.v2.uploadMedia().
 *   - Text is posted with client.v2.tweet().
 *
 * Env vars: X_API_KEY, X_API_SECRET
 */

import sharp from "sharp";
import { TwitterApi } from "twitter-api-v2";
import type {
  AuthenticateResult,
  GenerateAuthUrlResult,
  ProviderCapabilities,
  PublishRequest,
  PublishResult,
  RefreshTokenResult,
  SocialProviderAdapter,
  SocialProviderError,
} from "@/lib/social/provider-interface";
import { registerProvider } from "@/lib/social/provider-registry";

// ---------------------------------------------------------------------------
// Environment helpers
// ---------------------------------------------------------------------------

function getApiKey(): string {
  const key = process.env.X_API_KEY;
  if (!key) throw new Error("X_API_KEY environment variable is not set.");
  return key;
}

function getApiSecret(): string {
  const secret = process.env.X_API_SECRET;
  if (!secret) throw new Error("X_API_SECRET environment variable is not set.");
  return secret;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Download an image from a URL and resize it to at most 1000px wide,
 * preserving aspect ratio. Returns a Buffer suitable for uploadMedia().
 */
async function fetchAndResizeImage(imageUrl: string): Promise<Buffer> {
  const resp = await fetch(imageUrl);
  if (!resp.ok) {
    throw new Error(
      `X: failed to download image: ${resp.status} ${imageUrl}`,
    );
  }
  const raw = Buffer.from(await resp.arrayBuffer());

  return sharp(raw)
    .resize({ width: 1000, withoutEnlargement: true })
    .toBuffer();
}

/**
 * Build a TwitterApi client for an access token stored as "token:secret".
 */
function buildClient(accessToken: string): TwitterApi {
  const [tokenPart, secretPart] = accessToken.split(":");
  return new TwitterApi({
    appKey: getApiKey(),
    appSecret: getApiSecret(),
    accessToken: tokenPart,
    accessSecret: secretPart,
  });
}

// ---------------------------------------------------------------------------
// Provider implementation
// ---------------------------------------------------------------------------

export const xProvider: SocialProviderAdapter = {
  identifier: "x",
  displayName: "X (Twitter)",
  maxContentLength: 280,
  supportsImages: true,
  supportsVideo: false,
  supportsCarousel: false,
  maxImages: 4,
  maxConcurrentJobs: 1,
  requiresPageSelection: false,

  // -------------------------------------------------------------------------
  // OAuth
  // -------------------------------------------------------------------------

  async generateAuthUrl(callbackUrl: string): Promise<GenerateAuthUrlResult> {
    const client = new TwitterApi({
      appKey: getApiKey(),
      appSecret: getApiSecret(),
    });

    const { url, oauth_token, oauth_token_secret } =
      await client.generateAuthLink(callbackUrl, {
        authAccessType: "write",
        linkMode: "authenticate",
        forceLogin: false,
      });

    return {
      url,
      state: oauth_token,
      // Store both halves so authenticate() can reconstruct the pre-login client
      codeVerifier: `${oauth_token}:${oauth_token_secret}`,
    };
  },

  async authenticate(params: {
    code: string; // oauth_verifier from callback
    codeVerifier?: string; // "oauth_token:oauth_token_secret"
    state?: string;
  }): Promise<AuthenticateResult> {
    const { code: oauthVerifier, codeVerifier = "" } = params;
    const [oauthToken, oauthTokenSecret] = codeVerifier.split(":");

    const startingClient = new TwitterApi({
      appKey: getApiKey(),
      appSecret: getApiSecret(),
      accessToken: oauthToken,
      accessSecret: oauthTokenSecret,
    });

    const { accessToken, accessSecret, client } =
      await startingClient.login(oauthVerifier);

    const {
      data: { id, name, username, profile_image_url },
    } = await client.v2.me({
      "user.fields": ["username", "profile_image_url", "name"],
    });

    return {
      // Encode as "token:secret" so post() can split it back
      platformUserId: String(id),
      accessToken: `${accessToken}:${accessSecret}`,
      displayName: name,
      username,
      avatarUrl: profile_image_url ?? undefined,
      // OAuth 1.0a tokens are permanent — no expiry
    };
  },

  /**
   * OAuth 1.0a tokens do not expire and there is no refresh endpoint.
   * Return the same token unchanged.
   */
  async refreshToken(_refreshToken: string): Promise<RefreshTokenResult> {
    return { accessToken: _refreshToken };
  },

  // -------------------------------------------------------------------------
  // Publishing
  // -------------------------------------------------------------------------

  async post(
    _platformUserId: string,
    accessToken: string,
    requests: PublishRequest[],
    _options?: { accessTokenSecret?: string },
  ): Promise<PublishResult[]> {
    const [request] = requests;
    if (!request) return [];

    const client = buildClient(accessToken);

    const images = (request.media ?? []).filter((m) => m.type === "image");

    // Upload all images, capping at maxImages
    const mediaIds: string[] = [];
    for (const img of images.slice(0, 4)) {
      const buffer = await fetchAndResizeImage(img.url);
      const mediaId = await client.v2.uploadMedia(buffer, {
        media_type: "image/jpeg",
      });
      mediaIds.push(mediaId);
    }

    const tweetPayload: Record<string, unknown> = { text: request.content };
    if (mediaIds.length) {
      tweetPayload.media = { media_ids: mediaIds };
    }
    const { data } = (await client.v2.tweet(
      tweetPayload as Parameters<typeof client.v2.tweet>[0],
    )) as { data: { id: string } };

    // Retrieve username for the post URL
    const {
      data: { username },
    } = await client.v2.me({ "user.fields": ["username"] });

    return [
      {
        postId: request.postId,
        platformPostId: data.id,
        platformPostUrl: `https://x.com/${username}/status/${data.id}`,
        status: "published",
      },
    ];
  },

  // -------------------------------------------------------------------------
  // Error classification
  // -------------------------------------------------------------------------

  classifyError(error: unknown): SocialProviderError {
    const body =
      error instanceof Error
        ? error.message
        : typeof error === "string"
          ? error
          : JSON.stringify(error);

    // Rate limit
    if (
      body.includes("429") ||
      body.includes("Too Many Requests") ||
      body.includes("Rate limit") ||
      body.includes("rate-limit-exceeded")
    ) {
      return {
        type: "retry",
        message: "X rate limit reached. Will retry shortly.",
        original: error,
      };
    }

    // Auth / token issues
    if (
      body.includes("401") ||
      body.includes("Unauthorized") ||
      body.includes("Unsupported Authentication") ||
      body.includes("Invalid or expired token")
    ) {
      return {
        type: "refresh-token",
        message: "X authentication has expired. Please reconnect your account.",
        original: error,
      };
    }

    // Content policy / duplicate violations
    if (
      body.includes("duplicate") ||
      body.includes("usage-capped") ||
      body.includes("duplicate-rules") ||
      body.includes("invalid URL") ||
      body.includes("policy") ||
      body.includes("forbidden")
    ) {
      return {
        type: "bad-body",
        message:
          error instanceof Error
            ? error.message
            : "The post was rejected by X.",
        original: error,
      };
    }

    return {
      type: "retry",
      message:
        error instanceof Error ? error.message : "An unexpected X error occurred.",
      original: error,
    };
  },

  // -------------------------------------------------------------------------
  // Capabilities
  // -------------------------------------------------------------------------

  getCapabilities(): ProviderCapabilities {
    return {
      identifier: "x",
      displayName: "X (Twitter)",
      maxContentLength: 280,
      supportsImages: true,
      supportsVideo: false,
      supportsCarousel: false,
      requiresPageSelection: false,
    };
  },
};

// Register at module load time
registerProvider(xProvider);
