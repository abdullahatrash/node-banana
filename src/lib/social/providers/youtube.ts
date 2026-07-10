import { randomBytes } from "node:crypto";
import { Readable } from "node:stream";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
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
 * Convert a public URL to a Node.js Readable by fetching it and bridging the
 * response body. Used for streaming video/thumbnail uploads.
 *
 * Node's native `fetch()` (undici) exposes `response.body` as a WHATWG
 * `ReadableStream`, which has no `.pipe()` method. `googleapis-common`'s
 * multipart uploader unconditionally calls `part.body.pipe(...)` on the media
 * body, so handing it the raw Web stream throws
 * `TypeError: part.body.pipe is not a function` before any upload request is
 * made. `Readable.fromWeb()` (Node 17+) bridges the Web stream to a Node
 * Readable with the `.pipe()` API the uploader requires.
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
  if (!response.body) {
    throw new Error(`YouTube: empty response body for URL: ${url}`);
  }
  return Readable.fromWeb(response.body as unknown as WebReadableStream<Uint8Array>);
}

/**
 * Extract a searchable signal string + HTTP status from a thrown error.
 *
 * A real googleapis call throws a `GaxiosError` whose `.message` is ONLY the
 * Google API error's `.message` field — the machine-readable `reason` enum
 * (e.g. "quotaExceeded", "forbidden", "authError") and the AIP `status` enum
 * (e.g. "UNAUTHENTICATED") live in `.response.data.error`, never folded into
 * `.message`. Matching on `.message` alone left every reason-based branch of
 * classifyError() dead, so real 401/403s fell through to generic "retry".
 * We therefore fold the structured response body into the signal string and
 * expose the numeric HTTP status.
 */
function extractGoogleErrorSignals(error: unknown): {
  message: string;
  signals: string;
  httpStatus?: number;
} {
  const message = error instanceof Error ? error.message : String(error);
  const parts: string[] = [message];
  let httpStatus: number | undefined;

  if (error && typeof error === "object") {
    const e = error as {
      status?: unknown;
      code?: unknown;
      response?: { status?: unknown; data?: unknown };
    };

    const rawStatus = e.status ?? e.response?.status ?? e.code;
    if (typeof rawStatus === "number") {
      httpStatus = rawStatus;
    }

    const errorBody = (e.response?.data as { error?: unknown } | undefined)
      ?.error;
    if (errorBody !== undefined) {
      parts.push(
        typeof errorBody === "string" ? errorBody : JSON.stringify(errorBody),
      );
    }
  }

  return { message, signals: parts.join(" "), httpStatus };
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
    const { message, signals, httpStatus } = extractGoogleErrorSignals(error);

    // Content / permanent failures. Checked FIRST because some map to HTTP
    // statuses that would otherwise be swept up by the broad status buckets
    // below (e.g. "youtubeSignupRequired" is a 401 that must fail fast, not
    // trigger a token refresh).
    if (
      signals.includes("invalidTitle") ||
      signals.includes("invalidDescription") ||
      signals.includes("invalidTags") ||
      signals.includes("youtubeSignupRequired") ||
      signals.includes("uploadLimitExceeded") ||
      signals.includes("videoDurationTooLong") ||
      signals.includes("videoFileSizeTooLarge") ||
      signals.includes("failedPrecondition") ||
      signals.includes("forbidden") ||
      signals.includes("privacySettingNotSupportedForPartner")
    ) {
      return {
        type: "bad-body",
        message: `YouTube content validation failed: ${message}`,
        original: error,
      };
    }

    // Auth / re-auth. A real GaxiosError from an expired token against the
    // Data API surfaces as HTTP 401 with reason "authError" / AIP status
    // "UNAUTHENTICATED" — none of which reach `.message`.
    if (
      httpStatus === 401 ||
      signals.includes("Unauthorized") ||
      signals.includes("UNAUTHENTICATED") ||
      signals.includes("authError") ||
      signals.includes("invalid_grant") ||
      signals.includes("Token has been expired") ||
      signals.includes("token expired")
    ) {
      return {
        type: "refresh-token",
        message:
          "YouTube access token is invalid or expired — please re-authenticate",
        original: error,
      };
    }

    // Transient / retry.
    if (
      signals.includes("quotaExceeded") ||
      signals.includes("rateLimitExceeded") ||
      signals.includes("backendError") ||
      signals.includes("internalError") ||
      signals.includes("serviceUnavailable") ||
      signals.includes("transientError") ||
      httpStatus === 429 ||
      httpStatus === 500 ||
      httpStatus === 503
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
