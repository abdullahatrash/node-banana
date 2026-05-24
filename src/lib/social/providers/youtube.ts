import { randomBytes } from "node:crypto";
import { google } from "googleapis";
import type {
  AuthenticateParams,
  AuthenticateResult,
  GenerateAuthUrlResult,
  PageInfo,
  ProviderCapabilities,
  PublishRequest,
  PublishResult,
  RefreshTokenResult,
  SocialProviderAdapter,
  SocialProviderError,
} from "@/lib/social/provider-interface";
import { registerProvider } from "@/lib/social/provider-registry";

const YOUTUBE_SCOPES = [
  "https://www.googleapis.com/auth/userinfo.profile",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/youtube.upload",
  "https://www.googleapis.com/auth/youtube.readonly",
];

function buildOAuth2Client(redirectUri?: string) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error(
      "GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be configured",
    );
  }
  return new google.auth.OAuth2({ clientId, clientSecret, redirectUri });
}

/**
 * Convert a public URL to a Node.js-compatible ReadableStream by fetching
 * it and returning the response body. Used for streaming video uploads.
 */
async function urlToReadableStream(
  url: string,
): Promise<NodeJS.ReadableStream> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `YouTube: failed to fetch video from URL: ${response.status} ${url}`,
    );
  }
  // response.body is a ReadableStream (Web Streams API). The googleapis
  // upload accepts a Node.js Readable, but in practice passing the Web
  // ReadableStream works fine in Node 18+ since they share the stream
  // protocol for piping.
  return response.body as unknown as NodeJS.ReadableStream;
}

export const youTubeProvider: SocialProviderAdapter = {
  identifier: "youtube",
  displayName: "YouTube",
  maxContentLength: 5000,
  supportsImages: false,
  supportsVideo: true,
  supportsCarousel: false,
  maxImages: 0,
  maxConcurrentJobs: 3,
  requiresPageSelection: true,

  async generateAuthUrl(callbackUrl: string): Promise<GenerateAuthUrlResult> {
    const client = buildOAuth2Client(callbackUrl);
    const state = randomBytes(16).toString("hex");
    const url = client.generateAuthUrl({
      access_type: "offline",
      prompt: "consent",
      scope: YOUTUBE_SCOPES,
      state,
      redirect_uri: callbackUrl,
    });
    return { url, state };
  },

  async authenticate(params: AuthenticateParams): Promise<AuthenticateResult> {
    const client = buildOAuth2Client(params.redirectUri);
    const { tokens } = await client.getToken(params.code);
    client.setCredentials(tokens);

    const oauth2 = google.oauth2({ version: "v2", auth: client });
    const { data: userInfo } = await oauth2.userinfo.get();

    const expiresIn = tokens.expiry_date
      ? Math.floor((tokens.expiry_date - Date.now()) / 1000)
      : 3600;

    return {
      platformUserId: userInfo.id ?? "",
      accessToken: tokens.access_token ?? "",
      refreshToken: tokens.refresh_token ?? undefined,
      expiresIn: expiresIn > 0 ? expiresIn : 3600,
      displayName: userInfo.name ?? "YouTube User",
      avatarUrl: userInfo.picture ?? undefined,
      requiresPageSelection: true,
    };
  },

  async refreshToken(refreshToken: string): Promise<RefreshTokenResult> {
    const client = buildOAuth2Client();
    client.setCredentials({ refresh_token: refreshToken });
    const { credentials } = await client.refreshAccessToken();

    const expiresIn = credentials.expiry_date
      ? Math.floor((credentials.expiry_date - Date.now()) / 1000)
      : 3600;

    return {
      accessToken: credentials.access_token ?? "",
      refreshToken: credentials.refresh_token ?? refreshToken,
      expiresIn: expiresIn > 0 ? expiresIn : 3600,
    };
  },

  async post(
    _platformUserId: string,
    accessToken: string,
    requests: PublishRequest[],
  ): Promise<PublishResult[]> {
    const client = buildOAuth2Client();
    client.setCredentials({ access_token: accessToken });
    const yt = google.youtube({ version: "v3", auth: client });

    const results: PublishResult[] = [];

    for (const request of requests) {
      const media = request.media ?? [];
      const videoItem = media.find((m) => m.type === "video");
      if (!videoItem) {
        throw new Error("YouTube requires exactly one video media item");
      }

      const settings = request.platformSettings ?? {};
      const title =
        (settings.title as string | undefined) ??
        request.content.slice(0, 100);
      const privacyStatus =
        (settings.privacyStatus as string | undefined) ?? "public";
      const tags = (settings.tags as string[] | undefined) ?? [];
      const madeForKids = settings.madeForKids === true;
      const categoryId =
        (settings.categoryId as string | undefined) ?? "22"; // "People & Blogs"

      const videoStream = await urlToReadableStream(videoItem.url);

      const insertResponse = await yt.videos.insert({
        part: ["id", "snippet", "status"],
        requestBody: {
          snippet: {
            title,
            description: request.content,
            tags,
            categoryId,
          },
          status: {
            privacyStatus,
            selfDeclaredMadeForKids: madeForKids,
          },
        },
        media: {
          body: videoStream,
        },
      });

      const videoId = insertResponse.data.id ?? "";
      const platformPostUrl = `https://www.youtube.com/watch?v=${videoId}`;

      // Upload thumbnail if provided — best effort, non-fatal
      const thumbnailUrl = settings.thumbnailUrl as string | undefined;
      if (thumbnailUrl) {
        try {
          const thumbStream = await urlToReadableStream(thumbnailUrl);
          await yt.thumbnails.set({
            videoId,
            media: { body: thumbStream },
          });
        } catch {
          // Non-fatal — YouTube thumbnail upload can fail due to channel
          // eligibility requirements. The video is already published.
        }
      }

      results.push({
        postId: request.postId,
        platformPostId: videoId,
        platformPostUrl,
        status: "published",
      });
    }

    return results;
  },

  classifyError(error: unknown): SocialProviderError {
    const message = error instanceof Error ? error.message : String(error);

    if (
      message.includes("Unauthorized") ||
      message.includes("UNAUTHENTICATED") ||
      message.includes("invalid_grant") ||
      message.includes("Token has been expired") ||
      message.includes("token expired")
    ) {
      return {
        type: "refresh-token",
        message:
          "YouTube access token is invalid or expired — please re-authenticate",
        original: error,
      };
    }

    if (
      message.includes("invalidTitle") ||
      message.includes("invalidDescription") ||
      message.includes("invalidTags") ||
      message.includes("youtubeSignupRequired") ||
      message.includes("uploadLimitExceeded") ||
      message.includes("videoDurationTooLong") ||
      message.includes("videoFileSizeTooLarge") ||
      message.includes("failedPrecondition") ||
      message.includes("forbidden") ||
      message.includes("privacySettingNotSupportedForPartner")
    ) {
      return {
        type: "bad-body",
        message: `YouTube content validation failed: ${message}`,
        original: error,
      };
    }

    if (
      message.includes("quotaExceeded") ||
      message.includes("rateLimitExceeded") ||
      message.includes("backendError") ||
      message.includes("internalError") ||
      message.includes("serviceUnavailable") ||
      message.includes("transientError")
    ) {
      return {
        type: "retry",
        message: "YouTube API quota or server error — will retry",
        original: error,
      };
    }

    return { type: "retry", message, original: error };
  },

  async fetchPageInformation(accessToken: string): Promise<PageInfo[]> {
    const client = buildOAuth2Client();
    client.setCredentials({ access_token: accessToken });
    const yt = google.youtube({ version: "v3", auth: client });

    const response = await yt.channels.list({
      part: ["snippet"],
      mine: true,
    });

    const items = response.data.items ?? [];
    return items.map((channel) => ({
      id: channel.id ?? "",
      name: channel.snippet?.title ?? "YouTube Channel",
      username: channel.snippet?.customUrl ?? undefined,
      picture:
        channel.snippet?.thumbnails?.default?.url ?? undefined,
    }));
  },

  getCapabilities(): ProviderCapabilities {
    return {
      identifier: "youtube",
      displayName: "YouTube",
      maxContentLength: 5000,
      supportsImages: false,
      supportsVideo: true,
      supportsCarousel: false,
      requiresPageSelection: true,
    };
  },
};

registerProvider(youTubeProvider);
