/**
 * Instagram provider adapter.
 *
 * Instagram Business accounts publish via the Meta Graph API using a
 * container-based async flow:
 *   1. POST /{ig-user-id}/media  → create a container
 *   2. Poll GET /{container-id}?fields=status_code until FINISHED
 *   3. POST /{ig-user-id}/media_publish?creation_id={container-id}
 *   4. GET /{media-id}?fields=permalink
 *
 * Carousel posts add an extra step: each item is created with
 * is_carousel_item=true, then a parent CAROUSEL container is created
 * before the final publish call.
 *
 * The OAuth flow uses Facebook Login (same as the Facebook provider) but
 * with different scopes. After the initial code exchange the caller must
 * call fetchPageInformation() to resolve which IG Business account they
 * want to post from, then store that account's page-scoped access token.
 *
 * Env vars: META_APP_ID, META_APP_SECRET
 */

import type {
  AuthenticateParams,
  AuthenticateResult,
  GenerateAuthUrlResult,
  PageInfo,
  PublishRequest,
  PublishResult,
  RefreshTokenResult,
  SocialProviderAdapter,
  SocialProviderError,
} from "@/lib/social/provider-interface";
import { registerProvider } from "@/lib/social/provider-registry";
import {
  classifyMetaError,
  exchangeCodeForToken,
  exchangeForLongLivedToken,
  getMetaAppId,
  GRAPH_BASE,
  makeOAuthState,
  MetaApiError,
  metaErrorToClassifierBody,
  verifyGrantedScopes,
} from "@/lib/social/providers/meta-common";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SCOPES = [
  "instagram_basic",
  "pages_show_list",
  "pages_read_engagement",
  "business_management",
  "instagram_content_publish",
  "instagram_manage_comments",
  "instagram_manage_insights",
];

/** Milliseconds to wait between container status polls. */
const POLL_INTERVAL_MS = 30_000;

/** Maximum number of poll attempts before giving up. */
const MAX_POLL_ATTEMPTS = 10;

// ---------------------------------------------------------------------------
// Helper: poll container until FINISHED
// ---------------------------------------------------------------------------

async function pollContainerStatus(
  containerId: string,
  accessToken: string,
): Promise<void> {
  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
    const url =
      `${GRAPH_BASE}/${containerId}` +
      `?fields=status_code&access_token=${encodeURIComponent(accessToken)}`;

    const response = await fetch(url);
    const data = (await response.json()) as {
      status_code?: string;
      error?: { message: string; code: number };
    };

    if (data.error) {
      throw new MetaApiError(
        data.error.message,
        data.error.code,
        JSON.stringify(data),
      );
    }

    const statusCode = data.status_code ?? "IN_PROGRESS";

    if (statusCode === "FINISHED") {
      return;
    }

    if (statusCode === "ERROR" || statusCode === "EXPIRED") {
      throw new MetaApiError(
        `Instagram container processing failed with status: ${statusCode}`,
        undefined,
        JSON.stringify(data),
      );
    }

    // IN_PROGRESS or any other transient state — wait then retry
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  throw new MetaApiError(
    `Instagram container ${containerId} did not finish processing after ${MAX_POLL_ATTEMPTS} polls.`,
  );
}

// ---------------------------------------------------------------------------
// Helper: create a single media container
// ---------------------------------------------------------------------------

async function createMediaContainer(
  igUserId: string,
  accessToken: string,
  opts: {
    mediaUrl: string;
    isVideo: boolean;
    caption?: string;
    isCarouselItem?: boolean;
  },
): Promise<string> {
  const params = new URLSearchParams();
  params.set("access_token", accessToken);

  if (opts.isVideo) {
    params.set("video_url", opts.mediaUrl);
    params.set("media_type", "REELS");
  } else {
    params.set("image_url", opts.mediaUrl);
  }

  if (opts.caption) {
    params.set("caption", opts.caption);
  }

  if (opts.isCarouselItem) {
    params.set("is_carousel_item", "true");
  }

  const url = `${GRAPH_BASE}/${igUserId}/media?${params.toString()}`;
  const response = await fetch(url, { method: "POST" });
  const data = (await response.json()) as {
    id?: string;
    error?: { message: string; code: number };
  };

  if (data.error || !data.id) {
    throw new MetaApiError(
      data.error?.message ?? "Failed to create media container",
      data.error?.code,
      JSON.stringify(data),
    );
  }

  return data.id;
}

// ---------------------------------------------------------------------------
// Helper: publish a container
// ---------------------------------------------------------------------------

async function publishContainer(
  igUserId: string,
  creationId: string,
  accessToken: string,
): Promise<string> {
  const params = new URLSearchParams({
    creation_id: creationId,
    access_token: accessToken,
    field: "id",
  });

  const url = `${GRAPH_BASE}/${igUserId}/media_publish?${params.toString()}`;
  const response = await fetch(url, { method: "POST" });
  const data = (await response.json()) as {
    id?: string;
    error?: { message: string; code: number };
  };

  if (data.error || !data.id) {
    throw new MetaApiError(
      data.error?.message ?? "Failed to publish media container",
      data.error?.code,
      JSON.stringify(data),
    );
  }

  return data.id;
}

// ---------------------------------------------------------------------------
// Helper: fetch media permalink
// ---------------------------------------------------------------------------

async function fetchPermalink(
  mediaId: string,
  accessToken: string,
): Promise<string> {
  const url =
    `${GRAPH_BASE}/${mediaId}` +
    `?fields=permalink&access_token=${encodeURIComponent(accessToken)}`;

  const response = await fetch(url);
  const data = (await response.json()) as {
    permalink?: string;
    error?: { message: string; code: number };
  };

  if (data.error) {
    throw new MetaApiError(
      data.error.message,
      data.error.code,
      JSON.stringify(data),
    );
  }

  return data.permalink ?? `https://www.instagram.com/p/${mediaId}/`;
}

// ---------------------------------------------------------------------------
// Provider implementation
// ---------------------------------------------------------------------------

export const instagramProvider: SocialProviderAdapter = {
  identifier: "instagram",
  displayName: "Instagram",
  maxContentLength: 2200,
  supportsImages: true,
  supportsVideo: true,
  supportsCarousel: true,
  maxImages: 10,
  maxConcurrentJobs: 5,
  requiresPageSelection: true,

  // -------------------------------------------------------------------------
  // OAuth
  // -------------------------------------------------------------------------

  async generateAuthUrl(callbackUrl: string): Promise<GenerateAuthUrlResult> {
    const state = makeOAuthState(16);
    const url =
      "https://www.facebook.com/v20.0/dialog/oauth" +
      `?client_id=${encodeURIComponent(getMetaAppId())}` +
      `&redirect_uri=${encodeURIComponent(callbackUrl)}` +
      `&state=${state}` +
      `&scope=${encodeURIComponent(SCOPES.join(","))}`;

    return { url, state, codeVerifier: makeOAuthState(10) };
  },

  async authenticate(params: AuthenticateParams): Promise<AuthenticateResult> {
    const redirectUri = params.redirectUri;

    const shortToken = await exchangeCodeForToken(params.code, redirectUri);
    const longToken = await exchangeForLongLivedToken(shortToken.access_token);

    await verifyGrantedScopes(longToken.access_token, SCOPES);

    const profileUrl =
      `${GRAPH_BASE}/me` +
      `?fields=id,name,picture&access_token=${encodeURIComponent(longToken.access_token)}`;
    const profileResp = await fetch(profileUrl);
    const profile = (await profileResp.json()) as {
      id: string;
      name: string;
      picture?: { data?: { url?: string } };
    };

    // ~59 days expressed in seconds (Meta long-lived tokens last 60 days)
    const FIFTY_NINE_DAYS_S = 59 * 24 * 60 * 60;

    return {
      platformUserId: profile.id,
      accessToken: longToken.access_token,
      refreshToken: longToken.access_token, // FB tokens self-refresh; store same value
      expiresIn: longToken.expires_in ?? FIFTY_NINE_DAYS_S,
      displayName: profile.name,
      avatarUrl: profile.picture?.data?.url ?? "",
      username: "",
      requiresPageSelection: true,
    };
  },

  async refreshToken(_refreshToken: string): Promise<RefreshTokenResult> {
    // Meta long-lived tokens are renewed by making a regular API call before
    // they expire; there is no explicit refresh endpoint. The caller should
    // re-authenticate once the token expires.
    return { accessToken: _refreshToken };
  },

  // -------------------------------------------------------------------------
  // Page selection
  // -------------------------------------------------------------------------

  /**
   * List all Instagram Business accounts visible to the user token.
   *
   * The flow is: Facebook Pages → instagram_business_account field → IG User.
   * We also walk Business Manager owned/client pages for completeness.
   */
  async fetchPageInformation(accessToken: string): Promise<PageInfo[]> {
    const seenPageIds = new Set<string>();
    const facebookPages: Array<{
      id: string;
      instagram_business_account?: { id: string };
    }> = [];

    const fetchPaginated = async (startUrl: string): Promise<void> => {
      let nextUrl: string | undefined = startUrl;
      while (nextUrl) {
        const resp = await fetch(nextUrl);
        const json = (await resp.json()) as {
          data?: typeof facebookPages;
          paging?: { next?: string };
        };
        if (json.data) {
          for (const page of json.data) {
            if (!seenPageIds.has(page.id)) {
              seenPageIds.add(page.id);
              facebookPages.push(page);
            }
          }
        }
        nextUrl = json.paging?.next;
      }
    };

    // Primary: pages explicitly shared during OAuth
    await fetchPaginated(
      `${GRAPH_BASE}/me/accounts` +
        `?fields=id,instagram_business_account,username,name,picture.type(large)` +
        `&limit=100&access_token=${encodeURIComponent(accessToken)}`,
    );

    // Secondary: Business Manager pages (best-effort)
    try {
      let bizUrl: string | undefined =
        `${GRAPH_BASE}/me/businesses?access_token=${encodeURIComponent(accessToken)}`;

      while (bizUrl) {
        const bizResp = await fetch(bizUrl);
        const bizData = (await bizResp.json()) as {
          data?: Array<{ id: string }>;
          paging?: { next?: string };
        };

        for (const biz of bizData.data ?? []) {
          try {
            await fetchPaginated(
              `${GRAPH_BASE}/${biz.id}/owned_pages` +
                `?fields=id,instagram_business_account,username,name,picture.type(large)` +
                `&limit=100&access_token=${encodeURIComponent(accessToken)}`,
            );
          } catch {
            // Best-effort
          }
          try {
            await fetchPaginated(
              `${GRAPH_BASE}/${biz.id}/client_pages` +
                `?fields=id,instagram_business_account,username,name,picture.type(large)` +
                `&limit=100&access_token=${encodeURIComponent(accessToken)}`,
            );
          } catch {
            // Best-effort
          }
        }

        bizUrl = bizData.paging?.next;
      }
    } catch {
      // Business Manager API not available for all tokens
    }

    // Resolve each FB Page → IG Business Account details
    const results = await Promise.all(
      facebookPages
        .filter((p) => p.instagram_business_account)
        .map(async (page) => {
          const igId = page.instagram_business_account!.id;

          const igResp = await fetch(
            `${GRAPH_BASE}/${igId}` +
              `?fields=name,username,profile_picture_url` +
              `&access_token=${encodeURIComponent(accessToken)}`,
          );
          const igData = (await igResp.json()) as {
            id?: string;
            name?: string;
            username?: string;
            profile_picture_url?: string;
          };

          // Fetch page-scoped access token (required for publishing)
          const pageResp = await fetch(
            `${GRAPH_BASE}/${page.id}` +
              `?fields=access_token,name,picture.type(large)` +
              `&access_token=${encodeURIComponent(accessToken)}`,
          );
          const pageData = (await pageResp.json()) as {
            access_token?: string;
          };

          return {
            id: igId,
            name: igData.name ?? igId,
            username: igData.username,
            picture: igData.profile_picture_url,
            accessToken: pageData.access_token,
          } satisfies PageInfo;
        }),
    );

    return results.filter((r) => r.id);
  },

  // -------------------------------------------------------------------------
  // Publishing
  // -------------------------------------------------------------------------

  async post(
    igUserId: string,
    accessToken: string,
    requests: PublishRequest[],
  ): Promise<PublishResult[]> {
    const [request] = requests;
    if (!request) return [];

    const media = request.media ?? [];
    const content = request.content;

    const images = media.filter((m) => m.type === "image");
    const videos = media.filter((m) => m.type === "video");

    // ------------------------------------------------------------------
    // Single video (Reel)
    // ------------------------------------------------------------------
    if (videos.length === 1 && images.length === 0) {
      const containerId = await createMediaContainer(igUserId, accessToken, {
        mediaUrl: videos[0].url,
        isVideo: true,
        caption: content,
      });

      await pollContainerStatus(containerId, accessToken);

      const mediaId = await publishContainer(igUserId, containerId, accessToken);
      const permalink = await fetchPermalink(mediaId, accessToken);

      return [
        {
          postId: request.postId,
          platformPostId: mediaId,
          platformPostUrl: permalink,
          status: "published",
        },
      ];
    }

    // ------------------------------------------------------------------
    // Single image
    // ------------------------------------------------------------------
    if (images.length === 1 && videos.length === 0) {
      const containerId = await createMediaContainer(igUserId, accessToken, {
        mediaUrl: images[0].url,
        isVideo: false,
        caption: content,
      });

      await pollContainerStatus(containerId, accessToken);

      const mediaId = await publishContainer(igUserId, containerId, accessToken);
      const permalink = await fetchPermalink(mediaId, accessToken);

      return [
        {
          postId: request.postId,
          platformPostId: mediaId,
          platformPostUrl: permalink,
          status: "published",
        },
      ];
    }

    // ------------------------------------------------------------------
    // Carousel (2-10 images)
    // ------------------------------------------------------------------
    if (images.length >= 2) {
      // Step 1: create individual carousel item containers
      const itemContainerIds = await Promise.all(
        images.map((img) =>
          createMediaContainer(igUserId, accessToken, {
            mediaUrl: img.url,
            isVideo: false,
            isCarouselItem: true,
          }),
        ),
      );

      // Step 2: poll each item container
      await Promise.all(
        itemContainerIds.map((id) => pollContainerStatus(id, accessToken)),
      );

      // Step 3: create the carousel container
      const carouselParams = new URLSearchParams({
        media_type: "CAROUSEL",
        caption: content,
        children: itemContainerIds.join(","),
        access_token: accessToken,
      });

      const carouselResp = await fetch(
        `${GRAPH_BASE}/${igUserId}/media?${carouselParams.toString()}`,
        { method: "POST" },
      );
      const carouselData = (await carouselResp.json()) as {
        id?: string;
        error?: { message: string; code: number };
      };

      if (carouselData.error || !carouselData.id) {
        throw new MetaApiError(
          carouselData.error?.message ?? "Failed to create carousel container",
          carouselData.error?.code,
          JSON.stringify(carouselData),
        );
      }

      // Step 4: poll carousel container
      await pollContainerStatus(carouselData.id, accessToken);

      // Step 5: publish
      const mediaId = await publishContainer(igUserId, carouselData.id, accessToken);
      const permalink = await fetchPermalink(mediaId, accessToken);

      return [
        {
          postId: request.postId,
          platformPostId: mediaId,
          platformPostUrl: permalink,
          status: "published",
        },
      ];
    }

    // No media — Instagram requires at least one media item
    throw new MetaApiError(
      "Instagram posts require at least one image or video.",
    );
  },

  // -------------------------------------------------------------------------
  // Error classification
  // -------------------------------------------------------------------------

  classifyError(error: unknown): SocialProviderError {
    const body = metaErrorToClassifierBody(error);

    return (
      classifyMetaError(body) ?? {
        type: "retry",
        message:
          error instanceof Error
            ? error.message
            : "An unexpected Instagram error occurred.",
        original: error,
      }
    );
  },

  // -------------------------------------------------------------------------
  // Capabilities
  // -------------------------------------------------------------------------

  getCapabilities() {
    return {
      identifier: "instagram" as const,
      displayName: "Instagram",
      maxContentLength: 2200,
      supportsImages: true,
      supportsVideo: true,
      supportsCarousel: true,
      requiresPageSelection: true,
    };
  },
};

registerProvider(instagramProvider);
