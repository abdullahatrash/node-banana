import { AtpAgent } from "@atproto/api";
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
import { detectFacets, graphemeLength } from "@/lib/social/bluesky-facets";

const BLUESKY_MAX_GRAPHEMES = 300;
const BLUESKY_MAX_IMAGES = 4;
const BLUESKY_MAX_IMAGE_BYTES = 1_048_576; // 1 MB

interface BlueskyRefreshData {
  refreshJwt: string;
  did: string;
  handle: string;
}

function stripLeadingAt(handle: string): string {
  return handle.startsWith("@") ? handle.slice(1) : handle;
}

function parseRefreshToken(refreshToken: string): BlueskyRefreshData {
  try {
    return JSON.parse(refreshToken) as BlueskyRefreshData;
  } catch {
    throw new Error("Invalid Bluesky refresh token format");
  }
}

function extractRkey(atUri: string): string {
  const parts = atUri.split("/");
  return parts[parts.length - 1];
}

export const blueskyProvider: SocialProviderAdapter = {
  identifier: "bluesky",
  displayName: "Bluesky",
  maxContentLength: BLUESKY_MAX_GRAPHEMES,
  supportsImages: true,
  supportsVideo: false,
  supportsCarousel: false,
  maxImages: BLUESKY_MAX_IMAGES,
  maxConcurrentJobs: 5,
  requiresPageSelection: false,

  async generateAuthUrl(_callbackUrl: string): Promise<GenerateAuthUrlResult> {
    throw new Error(
      "Bluesky uses App Password authentication, not OAuth redirect. Use the custom connect route instead.",
    );
  },

  async authenticate(params: AuthenticateParams): Promise<AuthenticateResult> {
    const handle = stripLeadingAt(params.state);
    const appPassword = params.code;

    const agent = new AtpAgent({ service: "https://bsky.social" });

    const loginResult = await agent.login({
      identifier: handle,
      password: appPassword,
    });

    const { did, accessJwt, refreshJwt } = loginResult.data as {
      did: string;
      handle: string;
      accessJwt: string;
      refreshJwt: string;
    };

    const profileResult = await agent.getProfile({ actor: did });
    const profile = profileResult.data as {
      did: string;
      handle: string;
      displayName?: string;
      avatar?: string;
    };

    const refreshTokenData: BlueskyRefreshData = {
      refreshJwt,
      did,
      handle: profile.handle,
    };

    return {
      platformUserId: did,
      accessToken: accessJwt,
      refreshToken: JSON.stringify(refreshTokenData),
      displayName: profile.displayName ?? profile.handle,
      username: profile.handle,
      avatarUrl: profile.avatar,
      requiresPageSelection: false,
    };
  },

  async refreshToken(refreshToken: string): Promise<RefreshTokenResult> {
    const refreshData = parseRefreshToken(refreshToken);

    const agent = new AtpAgent({ service: "https://bsky.social" });
    await agent.resumeSession(refreshData as Parameters<typeof agent.resumeSession>[0]);

    const session = agent.session as {
      accessJwt: string;
      refreshJwt: string;
      did: string;
      handle: string;
    };

    const newRefreshData: BlueskyRefreshData = {
      refreshJwt: session.refreshJwt,
      did: session.did,
      handle: session.handle,
    };

    return {
      accessToken: session.accessJwt,
      refreshToken: JSON.stringify(newRefreshData),
    };
  },

  async post(
    platformUserId: string,
    accessToken: string,
    requests: PublishRequest[],
  ): Promise<PublishResult[]> {
    const results: PublishResult[] = [];

    for (const request of requests) {
      const agent = new AtpAgent({ service: "https://bsky.social" });

      // Resume the existing session using the stored access token
      await agent.resumeSession({
        accessJwt: accessToken,
        refreshJwt: "",
        did: platformUserId,
        handle: "",
        active: true,
      } as Parameters<typeof agent.resumeSession>[0]);

      const text = request.content ?? "";

      // Validate grapheme length
      if (graphemeLength(text) > BLUESKY_MAX_GRAPHEMES) {
        throw new Error(
          `Bluesky post exceeds maximum length of ${BLUESKY_MAX_GRAPHEMES} graphemes.`,
        );
      }

      // Detect facets (links, mentions, hashtags)
      const facets = await detectFacets(text, async (handle) => {
        const result = await agent.com.atproto.identity.resolveHandle({
          handle,
        });
        return (result as { data: { did: string } }).data.did;
      });

      // Build post record
      const record: Record<string, unknown> = {
        text,
        createdAt: new Date().toISOString(),
      };

      if (facets.length > 0) {
        record.facets = facets;
      }

      // Handle image uploads (max 4, max 1MB each)
      const images = (request.media ?? [])
        .filter((m) => m.type === "image")
        .slice(0, BLUESKY_MAX_IMAGES);

      if (images.length > 0) {
        const uploadedImages: Array<{
          image: unknown;
          alt: string;
          aspectRatio?: { width: number; height: number };
        }> = [];

        for (const media of images) {
          const response = await fetch(media.url);
          if (!response.ok) {
            throw new Error(
              `Failed to download image from ${media.url}: ${response.status}`,
            );
          }

          const buffer = await response.arrayBuffer();
          if (buffer.byteLength > BLUESKY_MAX_IMAGE_BYTES) {
            throw new Error(
              `Image at ${media.url} exceeds maximum size of 1MB (${buffer.byteLength} bytes).`,
            );
          }

          const mimeType =
            media.mimeType ?? response.headers.get("content-type") ?? "image/jpeg";

          const uploadResult = await agent.uploadBlob(new Uint8Array(buffer), {
            encoding: mimeType,
          });

          const blobData = (uploadResult as { data: { blob: unknown } }).data
            .blob;

          uploadedImages.push({
            image: blobData,
            alt: media.alt ?? "",
          });
        }

        record.embed = {
          $type: "app.bsky.embed.images",
          images: uploadedImages,
        };
      }

      const postResult = (await agent.post(record)) as {
        uri: string;
        cid: string;
      };

      const rkey = extractRkey(postResult.uri);
      const postUrl = `https://bsky.app/profile/${platformUserId}/post/${rkey}`;

      results.push({
        postId: request.postId,
        platformPostId: postResult.uri,
        platformPostUrl: postUrl,
        status: "published",
      });
    }

    return results;
  },

  classifyError(error: unknown): SocialProviderError {
    const message = error instanceof Error ? error.message : String(error);

    if (message.includes("ExpiredToken")) {
      return {
        type: "refresh-token",
        message:
          "Bluesky authentication token has expired. Please reconnect your account.",
        original: error,
      };
    }

    if (
      message.includes("InvalidRequest: record is invalid") ||
      message.includes("exceeds maximum length") ||
      message.includes("exceeds maximum size")
    ) {
      return {
        type: "bad-body",
        message,
        original: error,
      };
    }

    if (message.includes("RateLimitExceeded") || message.includes("429")) {
      return {
        type: "retry",
        message:
          "Bluesky rate limit exceeded. Will retry.",
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
      identifier: "bluesky",
      displayName: "Bluesky",
      maxContentLength: BLUESKY_MAX_GRAPHEMES,
      supportsImages: true,
      supportsVideo: false,
      supportsCarousel: false,
      requiresPageSelection: false,
    };
  },
};

registerProvider(blueskyProvider);
