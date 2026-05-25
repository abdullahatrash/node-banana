import { randomBytes } from "node:crypto";
import type {
  AuthenticateParams,
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

const REDDIT_AUTHORIZE_URL = "https://www.reddit.com/api/v1/authorize";
const REDDIT_TOKEN_URL = "https://www.reddit.com/api/v1/access_token";
const REDDIT_ME_URL = "https://oauth.reddit.com/api/v1/me";
const REDDIT_SUBMIT_URL = "https://oauth.reddit.com/api/submit";
const REDDIT_SCOPES = ["identity", "submit", "read"];

function getUserAgent(): string {
  return process.env.REDDIT_USER_AGENT ?? "nodebanana/1.0";
}

function getClientCredentials(): { clientId: string; clientSecret: string } {
  const clientId = process.env.REDDIT_CLIENT_ID;
  const clientSecret = process.env.REDDIT_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET must be configured");
  }
  return { clientId, clientSecret };
}

function makeBasicAuth(clientId: string, clientSecret: string): string {
  return Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
}

function normalizeSubreddit(value: string): string {
  return value.trim().replace(/^\/?r\//i, "");
}

async function fetchRedditUser(
  accessToken: string,
): Promise<{ id: string; name: string; iconImg?: string }> {
  const response = await fetch(REDDIT_ME_URL, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "User-Agent": getUserAgent(),
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Reddit user info fetch failed: ${response.status} ${body}`);
  }

  const data = (await response.json()) as {
    id?: string;
    name?: string;
    icon_img?: string;
  };
  if (!data.id || !data.name) {
    throw new Error("Reddit user info response missing id or name");
  }

  return {
    id: data.id,
    name: data.name,
    iconImg: data.icon_img,
  };
}

export const redditProvider: SocialProviderAdapter = {
  identifier: "reddit",
  displayName: "Reddit",
  maxContentLength: 40_000,
  supportsImages: false,
  supportsVideo: false,
  supportsCarousel: false,
  maxImages: 0,
  maxConcurrentJobs: 5,
  requiresPageSelection: false,

  async generateAuthUrl(callbackUrl: string): Promise<GenerateAuthUrlResult> {
    const { clientId } = getClientCredentials();
    const state = randomBytes(16).toString("hex");
    const params = new URLSearchParams({
      client_id: clientId,
      response_type: "code",
      state,
      redirect_uri: callbackUrl,
      duration: "permanent",
      scope: REDDIT_SCOPES.join(" "),
    });

    return {
      url: `${REDDIT_AUTHORIZE_URL}?${params.toString()}`,
      state,
    };
  },

  async authenticate(params: AuthenticateParams): Promise<AuthenticateResult> {
    const { clientId, clientSecret } = getClientCredentials();
    const response = await fetch(REDDIT_TOKEN_URL, {
      method: "POST",
      headers: {
        Authorization: `Basic ${makeBasicAuth(clientId, clientSecret)}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": getUserAgent(),
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: params.code,
        redirect_uri: params.redirectUri,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Reddit token exchange failed: ${response.status} ${body}`);
    }

    const tokens = (await response.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
    };
    if (!tokens.access_token) {
      throw new Error("Reddit token exchange returned no access token");
    }

    const me = await fetchRedditUser(tokens.access_token);
    return {
      platformUserId: me.id,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresIn: tokens.expires_in,
      displayName: me.name,
      username: me.name,
      avatarUrl: me.iconImg,
      requiresPageSelection: false,
    };
  },

  async refreshToken(refreshToken: string): Promise<RefreshTokenResult> {
    const { clientId, clientSecret } = getClientCredentials();
    const response = await fetch(REDDIT_TOKEN_URL, {
      method: "POST",
      headers: {
        Authorization: `Basic ${makeBasicAuth(clientId, clientSecret)}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": getUserAgent(),
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Reddit token refresh failed: ${response.status} ${body}`);
    }

    const tokens = (await response.json()) as {
      access_token?: string;
      expires_in?: number;
    };
    if (!tokens.access_token) {
      throw new Error("Reddit token refresh returned no access token");
    }

    return {
      accessToken: tokens.access_token,
      refreshToken,
      expiresIn: tokens.expires_in,
    };
  },

  async post(
    _platformUserId: string,
    accessToken: string,
    requests: PublishRequest[],
  ): Promise<PublishResult[]> {
    const results: PublishResult[] = [];
    for (const request of requests) {
      const settings = request.platformSettings ?? {};
      const subreddit =
        typeof settings.subreddit === "string" ? settings.subreddit.trim() : "";
      if (!subreddit) {
        throw new Error("Reddit post requires platformSettings.subreddit.");
      }

      const titleInput =
        typeof settings.title === "string" ? settings.title.trim() : "";
      const title = (titleInput || request.content || "").trim().slice(0, 300);
      if (!title) {
        throw new Error("Reddit post requires a non-empty title or content.");
      }

      const postType = typeof settings.type === "string" ? settings.type : "self";
      const link =
        typeof settings.url === "string"
          ? settings.url.trim()
          : typeof settings.link === "string"
            ? settings.link.trim()
            : "";
      const hasMedia = (request.media?.length ?? 0) > 0;
      if (hasMedia && !link) {
        throw new Error(
          "Reddit provider currently supports text or link posts; media uploads are not supported.",
        );
      }
      if (postType === "link" && !link) {
        throw new Error("Reddit link posts require platformSettings.url.");
      }

      const form = new URLSearchParams({
        api_type: "json",
        sr: normalizeSubreddit(subreddit),
        title,
        kind: postType === "link" || link ? "link" : "self",
        resubmit: "true",
      });
      if (postType === "link" || link) {
        form.set("url", link);
      } else {
        form.set("text", request.content);
      }

      const response = await fetch(REDDIT_SUBMIT_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": getUserAgent(),
        },
        body: form,
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`Reddit submit failed: ${response.status} ${body}`);
      }

      const data = (await response.json()) as {
        json?: {
          errors?: Array<[string, string, string]>;
          data?: {
            name?: string;
            url?: string;
          };
        };
      };
      if ((data.json?.errors?.length ?? 0) > 0) {
        const messages = data.json?.errors?.map((entry) => entry[1]).join("; ");
        throw new Error(`Reddit submit validation failed: ${messages}`);
      }

      results.push({
        postId: request.postId,
        platformPostId: data.json?.data?.name ?? `reddit:${normalizeSubreddit(subreddit)}:${Date.now()}`,
        platformPostUrl: data.json?.data?.url ?? `https://www.reddit.com/r/${normalizeSubreddit(subreddit)}/new`,
        status: "published",
      });
    }

    return results;
  },

  classifyError(error: unknown): SocialProviderError {
    const message = error instanceof Error ? error.message : String(error);
    const lower = message.toLowerCase();

    if (
      lower.includes("401") ||
      lower.includes("unauthorized") ||
      lower.includes("invalid_grant") ||
      (lower.includes("token") && lower.includes("expired"))
    ) {
      return {
        type: "refresh-token",
        message: "Reddit authentication expired. Please reconnect your account.",
        original: error,
      };
    }

    if (
      lower.includes("validation") ||
      lower.includes("subreddit") ||
      lower.includes("title") ||
      lower.includes("bad request") ||
      lower.includes("media uploads are not supported")
    ) {
      return {
        type: "bad-body",
        message: message,
        original: error,
      };
    }

    if (
      lower.includes("429") ||
      lower.includes("rate limit") ||
      lower.includes("503") ||
      lower.includes("timeout") ||
      lower.includes("temporarily unavailable")
    ) {
      return {
        type: "retry",
        message: "Reddit is temporarily unavailable or rate-limited. Will retry.",
        original: error,
      };
    }

    return {
      type: "retry",
      message,
      original: error,
    };
  },

  getCapabilities(): ProviderCapabilities {
    return {
      identifier: "reddit",
      displayName: "Reddit",
      maxContentLength: 40_000,
      supportsImages: false,
      supportsVideo: false,
      supportsCarousel: false,
      requiresPageSelection: false,
    };
  },
};

registerProvider(redditProvider);
