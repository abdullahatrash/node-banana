import { randomBytes } from "node:crypto";
import type {
  AuthenticateParams,
  AuthenticateResult,
  GenerateAuthUrlResult,
  PublishRequest,
  PublishResult,
  RefreshTokenResult,
  SocialProviderAdapter,
  SocialProviderError,
} from "@/lib/social/provider-interface";
import { registerProvider } from "@/lib/social/provider-registry";

const PINTEREST_AUTHORIZE_URL = "https://www.pinterest.com/oauth/";
const PINTEREST_TOKEN_URL = "https://api.pinterest.com/v5/oauth/token";
const PINTEREST_USER_URL = "https://api.pinterest.com/v5/user_account";
const PINTEREST_CREATE_PIN_URL = "https://api.pinterest.com/v5/pins";
const PINTEREST_SCOPES = [
  "boards:read",
  "pins:read",
  "pins:write",
  "user_accounts:read",
];

function getCredentials(): { clientId: string; clientSecret: string } {
  const clientId = process.env.PINTEREST_CLIENT_ID;
  const clientSecret = process.env.PINTEREST_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error(
      "PINTEREST_CLIENT_ID and PINTEREST_CLIENT_SECRET must be configured",
    );
  }
  return { clientId, clientSecret };
}

async function fetchPinterestUser(accessToken: string): Promise<{
  id: string;
  username: string;
  avatarUrl?: string;
}> {
  const response = await fetch(PINTEREST_USER_URL, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Pinterest user fetch failed: ${response.status} ${body}`);
  }

  const data = (await response.json()) as {
    username?: string;
    account_type?: string;
    profile_image?: string;
    id?: string;
  };

  const username = data.username?.trim() || data.id?.trim();
  if (!username) {
    throw new Error("Pinterest user fetch returned no id or username");
  }

  return {
    id: data.id?.trim() || username,
    username,
    avatarUrl: data.profile_image?.trim(),
  };
}

export const pinterestProvider: SocialProviderAdapter = {
  identifier: "pinterest",
  displayName: "Pinterest",
  maxContentLength: 500,
  supportsImages: true,
  supportsVideo: false,
  supportsCarousel: false,
  maxImages: 1,
  maxConcurrentJobs: 5,
  requiresPageSelection: false,

  async generateAuthUrl(callbackUrl: string): Promise<GenerateAuthUrlResult> {
    const { clientId } = getCredentials();
    const state = randomBytes(16).toString("hex");
    const params = new URLSearchParams({
      response_type: "code",
      redirect_uri: callbackUrl,
      client_id: clientId,
      scope: PINTEREST_SCOPES.join(","),
      state,
    });

    return {
      url: `${PINTEREST_AUTHORIZE_URL}?${params.toString()}`,
      state,
    };
  },

  async authenticate(params: AuthenticateParams): Promise<AuthenticateResult> {
    const { clientId, clientSecret } = getCredentials();

    const response = await fetch(PINTEREST_TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: params.code,
        redirect_uri: params.redirectUri,
        client_id: clientId,
        client_secret: clientSecret,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Pinterest token exchange failed: ${response.status} ${body}`);
    }

    const token = (await response.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
    };
    if (!token.access_token) {
      throw new Error("Pinterest token exchange returned no access token");
    }

    const me = await fetchPinterestUser(token.access_token);

    return {
      platformUserId: me.id,
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      expiresIn: token.expires_in,
      displayName: me.username,
      username: me.username,
      avatarUrl: me.avatarUrl,
      requiresPageSelection: false,
    };
  },

  async refreshToken(refreshToken: string): Promise<RefreshTokenResult> {
    const { clientId, clientSecret } = getCredentials();

    const response = await fetch(PINTEREST_TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: clientId,
        client_secret: clientSecret,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Pinterest token refresh failed: ${response.status} ${body}`);
    }

    const token = (await response.json()) as {
      access_token?: string;
      expires_in?: number;
      refresh_token?: string;
    };
    if (!token.access_token) {
      throw new Error("Pinterest token refresh returned no access token");
    }

    return {
      accessToken: token.access_token,
      refreshToken: token.refresh_token ?? refreshToken,
      expiresIn: token.expires_in,
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
      const boardId =
        typeof settings.boardId === "string" ? settings.boardId.trim() : "";
      if (!boardId) {
        throw new Error("Pinterest post requires platformSettings.boardId.");
      }

      const media = request.media ?? [];
      if (media.length === 0) {
        throw new Error("Pinterest post requires one image.");
      }
      if (media.length > 1 || media.some((m) => m.type !== "image")) {
        throw new Error("Pinterest provider supports exactly one image per post.");
      }

      const title =
        (typeof settings.title === "string" ? settings.title.trim() : "") ||
        request.content.trim().slice(0, 100);
      const description = request.content.trim();
      const link = typeof settings.link === "string" ? settings.link.trim() : "";

      const payload: {
        board_id: string;
        title?: string;
        description?: string;
        link?: string;
        media_source: {
          source_type: "image_url";
          url: string;
        };
      } = {
        board_id: boardId,
        media_source: {
          source_type: "image_url",
          url: media[0].url,
        },
      };
      if (title) payload.title = title;
      if (description) payload.description = description;
      if (link) payload.link = link;

      const response = await fetch(PINTEREST_CREATE_PIN_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`Pinterest pin creation failed: ${response.status} ${body}`);
      }

      const data = (await response.json()) as {
        id?: string;
        link?: string;
        error?: { message?: string };
      };
      if (!data.id || data.error) {
        throw new Error(
          `Pinterest pin creation failed: ${
            data.error?.message ?? "Missing pin id in response"
          }`,
        );
      }

      results.push({
        postId: request.postId,
        platformPostId: data.id,
        platformPostUrl: `https://www.pinterest.com/pin/${data.id}/`,
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
      lower.includes("invalid token") ||
      lower.includes("expired")
    ) {
      return {
        type: "refresh-token",
        message: "Pinterest authentication expired. Please reconnect your account.",
        original: error,
      };
    }

    if (
      lower.includes("429") ||
      lower.includes("rate") ||
      lower.includes("timeout") ||
      lower.includes("503") ||
      lower.includes("temporarily unavailable")
    ) {
      return {
        type: "retry",
        message: "Pinterest is temporarily unavailable or rate-limited. Will retry.",
        original: error,
      };
    }

    if (
      lower.includes("board") ||
      lower.includes("validation") ||
      lower.includes("400") ||
      lower.includes("bad request") ||
      lower.includes("image")
    ) {
      return {
        type: "bad-body",
        message,
        original: error,
      };
    }

    return {
      type: "retry",
      message,
      original: error,
    };
  },

  getCapabilities() {
    return {
      identifier: "pinterest" as const,
      displayName: "Pinterest",
      maxContentLength: 500,
      supportsImages: true,
      supportsVideo: false,
      supportsCarousel: false,
      requiresPageSelection: false,
    };
  },
};

registerProvider(pinterestProvider);
