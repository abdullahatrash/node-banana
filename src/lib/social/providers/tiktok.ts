import { randomBytes } from "node:crypto";
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

const TIKTOK_OAUTH_SCOPES = [
  "video.list",
  "user.info.basic",
  "video.publish",
  "video.upload",
  "user.info.profile",
  "user.info.stats",
];

const TIKTOK_TOKEN_URL = "https://open.tiktokapis.com/v2/oauth/token/";
const TIKTOK_USER_INFO_URL =
  "https://open.tiktokapis.com/v2/user/info/?fields=open_id,avatar_url,display_name,union_id,username";
const TIKTOK_PUBLISH_STATUS_URL =
  "https://open.tiktokapis.com/v2/post/publish/status/fetch/";

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchTikTokUserInfo(accessToken: string): Promise<{
  openId: string;
  displayName: string;
  avatarUrl: string;
  username: string;
}> {
  const response = await fetch(TIKTOK_USER_INFO_URL, {
    method: "GET",
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`TikTok user info fetch failed: ${response.status} ${body}`);
  }

  const {
    data: {
      user: { open_id, display_name, avatar_url, username },
    },
  } = await response.json();

  return {
    openId: (open_id as string).replace(/-/g, ""),
    displayName: display_name as string,
    avatarUrl: (avatar_url as string) ?? "",
    username: (username as string) ?? "",
  };
}

export async function pollTikTokPublishStatus(
  username: string,
  publishId: string,
  accessToken: string,
  pollIntervalMs = 10_000,
): Promise<{ platformPostId: string; platformPostUrl: string }> {
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const response = await fetch(TIKTOK_PUBLISH_STATUS_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=UTF-8",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ publish_id: publishId }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `TikTok publish status poll failed: ${response.status} ${body}`,
      );
    }

    const data = await response.json();
    const { status, publicaly_available_post_id } = data.data ?? {};

    if (status === "SEND_TO_USER_INBOX") {
      return {
        platformPostId: "inbox",
        platformPostUrl: "https://www.tiktok.com/messages?lang=en",
      };
    }

    if (status === "PUBLISH_COMPLETE") {
      const postId = publicaly_available_post_id?.[0] ?? publishId;
      const postUrl = publicaly_available_post_id?.[0]
        ? `https://www.tiktok.com/@${username}/video/${publicaly_available_post_id[0]}`
        : `https://www.tiktok.com/@${username}`;
      return { platformPostId: postId, platformPostUrl: postUrl };
    }

    if (status === "FAILED") {
      const errorCode = data.data?.fail_reason ?? data.error?.code ?? "unknown";
      throw new Error(
        `TikTok publish failed: ${errorCode} — ${JSON.stringify(data)}`,
      );
    }

    await delay(pollIntervalMs);
  }
}

async function initiateVideoPost(
  videoUrl: string,
  content: string,
  accessToken: string,
): Promise<string> {
  const response = await fetch(
    "https://open.tiktokapis.com/v2/post/publish/video/init/",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=UTF-8",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        post_info: {
          title: content.slice(0, 2200),
          privacy_level: "PUBLIC_TO_EVERYONE",
          disable_comment: false,
          disable_duet: false,
          disable_stitch: false,
        },
        source_info: {
          source: "PULL_FROM_URL",
          video_url: videoUrl,
        },
      }),
    },
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`TikTok video publish init failed: ${response.status} ${body}`);
  }

  const { data } = await response.json();
  return data.publish_id as string;
}

async function initiatePhotoPost(
  imageUrls: string[],
  content: string,
  accessToken: string,
): Promise<string> {
  const response = await fetch(
    "https://open.tiktokapis.com/v2/post/publish/content/init/",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=UTF-8",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        post_info: {
          description: content.slice(0, 2200),
          privacy_level: "PUBLIC_TO_EVERYONE",
          disable_comment: false,
          auto_add_music: false,
        },
        source_info: {
          source: "PULL_FROM_URL",
          photo_images: imageUrls,
          photo_cover_index: 0,
        },
        post_mode: "DIRECT_POST",
        media_type: "PHOTO",
      }),
    },
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`TikTok photo publish init failed: ${response.status} ${body}`);
  }

  const { data } = await response.json();
  return data.publish_id as string;
}

export const tikTokProvider: SocialProviderAdapter = {
  identifier: "tiktok",
  displayName: "TikTok",
  maxContentLength: 2200,
  supportsImages: true,
  supportsVideo: true,
  supportsCarousel: true,
  maxImages: 35,
  maxConcurrentJobs: 5,
  requiresPageSelection: false,

  async generateAuthUrl(callbackUrl: string): Promise<GenerateAuthUrlResult> {
    const clientKey = process.env.TIKTOK_CLIENT_KEY;
    if (!clientKey) {
      throw new Error("TIKTOK_CLIENT_KEY is not configured");
    }
    const state = randomBytes(16).toString("hex");
    const codeVerifier = randomBytes(32).toString("hex");
    const params = new URLSearchParams({
      client_key: clientKey,
      redirect_uri: callbackUrl,
      response_type: "code",
      scope: TIKTOK_OAUTH_SCOPES.join(","),
      state,
    });
    const url = `https://www.tiktok.com/v2/auth/authorize/?${params.toString()}`;
    return { url, state, codeVerifier };
  },

  async authenticate(params: {
    code: string;
    codeVerifier?: string;
    state?: string;
  }): Promise<AuthenticateResult> {
    const clientKey = process.env.TIKTOK_CLIENT_KEY;
    const clientSecret = process.env.TIKTOK_CLIENT_SECRET;
    if (!clientKey || !clientSecret) {
      throw new Error("TIKTOK_CLIENT_KEY and TIKTOK_CLIENT_SECRET must be configured");
    }
    const tokenResponse = await fetch(TIKTOK_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_key: clientKey,
        client_secret: clientSecret,
        code: params.code,
        grant_type: "authorization_code",
        redirect_uri: params.state ?? "",
      }),
    });
    if (!tokenResponse.ok) {
      const body = await tokenResponse.text();
      throw new Error(`TikTok token exchange failed: ${tokenResponse.status} ${body}`);
    }
    const { access_token: accessToken, refresh_token: refreshToken } =
      await tokenResponse.json();
    const TWENTY_THREE_HOURS_SECONDS = 23 * 60 * 60;
    const { openId, displayName, avatarUrl, username } =
      await fetchTikTokUserInfo(accessToken);
    return {
      platformUserId: openId,
      accessToken,
      refreshToken: refreshToken ?? undefined,
      expiresIn: TWENTY_THREE_HOURS_SECONDS,
      displayName: displayName ?? "TikTok User",
      username: username ?? undefined,
      avatarUrl: avatarUrl ?? undefined,
      requiresPageSelection: false,
    };
  },

  async refreshToken(refreshToken: string): Promise<RefreshTokenResult> {
    const clientKey = process.env.TIKTOK_CLIENT_KEY;
    const clientSecret = process.env.TIKTOK_CLIENT_SECRET;
    if (!clientKey || !clientSecret) {
      throw new Error("TIKTOK_CLIENT_KEY and TIKTOK_CLIENT_SECRET must be configured");
    }
    const response = await fetch(TIKTOK_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_key: clientKey,
        client_secret: clientSecret,
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }),
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`TikTok token refresh failed: ${response.status} ${body}`);
    }
    const { access_token: accessToken, refresh_token: newRefreshToken } =
      await response.json();
    const TWENTY_THREE_HOURS_SECONDS = 23 * 60 * 60;
    return {
      accessToken,
      refreshToken: newRefreshToken ?? refreshToken,
      expiresIn: TWENTY_THREE_HOURS_SECONDS,
    };
  },

  async post(
    platformUserId: string,
    accessToken: string,
    requests: PublishRequest[],
  ): Promise<PublishResult[]> {
    const results: PublishResult[] = [];
    for (const request of requests) {
      const media = request.media ?? [];
      const hasVideo = media.some((m) => m.type === "video");
      let publishId: string;
      if (hasVideo) {
        const videoItem = media.find((m) => m.type === "video");
        if (!videoItem) {
          throw new Error("TikTok video post requires exactly one video item");
        }
        publishId = await initiateVideoPost(videoItem.url, request.content, accessToken);
      } else if (media.length > 0) {
        const imageUrls = media.map((m) => m.url);
        publishId = await initiatePhotoPost(imageUrls, request.content, accessToken);
      } else {
        throw new Error("TikTok requires at least one media item (video or images)");
      }
      let username = platformUserId;
      try {
        const info = await fetchTikTokUserInfo(accessToken);
        username = info.username || platformUserId;
      } catch {
        // Non-fatal
      }
      const { platformPostId, platformPostUrl } =
        await pollTikTokPublishStatus(username, publishId, accessToken);
      results.push({
        postId: request.postId,
        platformPostId,
        platformPostUrl,
        status: "processing",
      });
    }
    return results;
  },

  classifyError(error: unknown): SocialProviderError {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("access_token_invalid") || message.includes('"code":"access_token_invalid"')) {
      return { type: "refresh-token", message: "TikTok access token is invalid — please re-authenticate", original: error };
    }
    if (message.includes("scope_not_authorized") || message.includes("scope_permission_missed")) {
      return { type: "refresh-token", message: "TikTok missing required permissions — please re-authenticate with all scopes", original: error };
    }
    if (message.includes("spam_risk_user_banned_from_posting") || message.includes("spam_risk_text") || message.includes("spam_risk_too_many_posts") || message.includes("spam_risk_too_many_pending_share") || message.includes("spam_risk")) {
      return { type: "bad-body", message: "TikTok spam detection triggered — post cannot be published", original: error };
    }
    if (message.includes("file_format_check_failed") || message.includes("duration_check_failed") || message.includes("frame_rate_check_failed") || message.includes("picture_size_check_failed") || message.includes("invalid_file_upload") || message.includes("invalid_params") || message.includes("privacy_level_option_mismatch") || message.includes("url_ownership_unverified")) {
      return { type: "bad-body", message: `TikTok content validation failed: ${message}`, original: error };
    }
    if (message.includes("video_pull_failed") || message.includes("photo_pull_failed")) {
      return { type: "retry", message: "TikTok failed to pull media from URL — will retry", original: error };
    }
    if (message.includes("rate_limit_exceeded")) {
      return { type: "retry", message: "TikTok API rate limit exceeded — will retry", original: error };
    }
    if (message.includes("app_version_check_failed") || message.includes("unaudited_client_can_only_post_to_private_accounts") || message.includes("reached_active_user_cap")) {
      return { type: "bad-body", message: `TikTok app policy error: ${message}`, original: error };
    }
    if (message.includes("internal") || message.includes("TikTok API error")) {
      return { type: "retry", message: "TikTok server error — will retry", original: error };
    }
    return { type: "retry", message, original: error };
  },

  getCapabilities(): ProviderCapabilities {
    return {
      identifier: "tiktok",
      displayName: "TikTok",
      maxContentLength: 2200,
      supportsImages: true,
      supportsVideo: true,
      supportsCarousel: true,
      requiresPageSelection: false,
    };
  },
};

registerProvider(tikTokProvider);
