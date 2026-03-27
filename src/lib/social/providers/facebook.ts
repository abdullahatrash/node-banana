/**
 * Facebook provider adapter.
 *
 * Posts to a Facebook Page (not a personal profile). The OAuth flow uses
 * Facebook Login with page-management scopes. After the initial code exchange
 * the caller must call fetchPageInformation() to list the user's Pages and
 * obtain a page-scoped access token for each.
 *
 * Publishing modes:
 *   - Text-only: POST /{page-id}/feed  { message }
 *   - Photos:    Upload each as unpublished via /{page-id}/photos,
 *                then POST /{page-id}/feed { attached_media: [...] }
 *   - Video:     POST /{page-id}/videos  { file_url, description }
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
  verifyGrantedScopes,
} from "@/lib/social/providers/meta-common";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SCOPES = [
  "pages_show_list",
  "business_management",
  "pages_manage_posts",
  "pages_manage_engagement",
  "pages_read_engagement",
  "read_insights",
];

// ---------------------------------------------------------------------------
// Publishing helpers
// ---------------------------------------------------------------------------

/**
 * Upload a single photo as an unpublished attachment on a Page.
 * Returns the photo's media_fbid for use in attached_media.
 */
async function uploadUnpublishedPhoto(
  pageId: string,
  pageAccessToken: string,
  imageUrl: string,
): Promise<string> {
  const response = await fetch(
    `${GRAPH_BASE}/${pageId}/photos?access_token=${encodeURIComponent(pageAccessToken)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: imageUrl, published: false }),
    },
  );

  const data = (await response.json()) as {
    id?: string;
    error?: { message: string; code: number };
  };

  if (data.error || !data.id) {
    throw new MetaApiError(
      data.error?.message ?? "Failed to upload photo",
      data.error?.code,
      JSON.stringify(data),
    );
  }

  return data.id;
}

// ---------------------------------------------------------------------------
// Provider implementation
// ---------------------------------------------------------------------------

export const facebookProvider: SocialProviderAdapter = {
  identifier: "facebook",
  displayName: "Facebook",
  maxContentLength: 63206,
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
      `&scope=${SCOPES.join(",")}`;

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

    const FIFTY_NINE_DAYS_S = 59 * 24 * 60 * 60;

    return {
      platformUserId: profile.id,
      accessToken: longToken.access_token,
      refreshToken: longToken.access_token,
      expiresIn: longToken.expires_in ?? FIFTY_NINE_DAYS_S,
      displayName: profile.name,
      avatarUrl: profile.picture?.data?.url ?? "",
      username: "",
      requiresPageSelection: true,
    };
  },

  async refreshToken(_refreshToken: string): Promise<RefreshTokenResult> {
    // Meta long-lived tokens do not have an explicit refresh endpoint.
    return { accessToken: _refreshToken };
  },

  // -------------------------------------------------------------------------
  // Page selection
  // -------------------------------------------------------------------------

  /**
   * List all Facebook Pages managed by the authenticated user.
   *
   * Returns a page-scoped access_token for each page so the caller can store
   * it and use it for publishing without needing the user token later.
   */
  async fetchPageInformation(accessToken: string): Promise<PageInfo[]> {
    const seenIds = new Set<string>();
    const pages: PageInfo[] = [];

    const fetchPaginated = async (startUrl: string): Promise<void> => {
      let nextUrl: string | undefined = startUrl;
      while (nextUrl) {
        const resp = await fetch(nextUrl);
        const json = (await resp.json()) as {
          data?: Array<{
            id: string;
            name: string;
            username?: string;
            access_token?: string;
            picture?: { data?: { url?: string } };
          }>;
          paging?: { next?: string };
        };

        for (const page of json.data ?? []) {
          if (!seenIds.has(page.id)) {
            seenIds.add(page.id);
            pages.push({
              id: page.id,
              name: page.name,
              username: page.username,
              picture: page.picture?.data?.url,
              accessToken: page.access_token,
            });
          }
        }

        nextUrl = json.paging?.next;
      }
    };

    // Primary: pages the user explicitly shared during OAuth
    await fetchPaginated(
      `${GRAPH_BASE}/me/accounts` +
        `?fields=id,username,name,access_token,picture.type(large)` +
        `&limit=100&access_token=${encodeURIComponent(accessToken)}`,
    );

    // Secondary: Business Manager owned/client pages (best-effort)
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
                `?fields=id,username,name,access_token,picture.type(large)` +
                `&limit=100&access_token=${encodeURIComponent(accessToken)}`,
            );
          } catch {
            // Best-effort
          }
          try {
            await fetchPaginated(
              `${GRAPH_BASE}/${biz.id}/client_pages` +
                `?fields=id,username,name,access_token,picture.type(large)` +
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

    return pages;
  },

  // -------------------------------------------------------------------------
  // Publishing
  // -------------------------------------------------------------------------

  async post(
    pageId: string,
    accessToken: string,
    requests: PublishRequest[],
  ): Promise<PublishResult[]> {
    const [request] = requests;
    if (!request) return [];

    const media = request.media ?? [];
    const content = request.content;

    const videos = media.filter((m) => m.type === "video");
    const images = media.filter((m) => m.type === "image");

    // ------------------------------------------------------------------
    // Video post
    // ------------------------------------------------------------------
    if (videos.length > 0) {
      const videoUrl = videos[0].url;

      const response = await fetch(
        `${GRAPH_BASE}/${pageId}/videos` +
          `?access_token=${encodeURIComponent(accessToken)}&fields=id,permalink_url`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            file_url: videoUrl,
            description: content,
            published: true,
          }),
        },
      );

      const data = (await response.json()) as {
        id?: string;
        permalink_url?: string;
        error?: { message: string; code: number };
      };

      if (data.error || !data.id) {
        throw new MetaApiError(
          data.error?.message ?? "Failed to upload video",
          data.error?.code,
          JSON.stringify(data),
        );
      }

      return [
        {
          postId: request.postId,
          platformPostId: data.id,
          platformPostUrl: data.permalink_url ?? `https://www.facebook.com/reel/${data.id}`,
          status: "published",
        },
      ];
    }

    // ------------------------------------------------------------------
    // Photo post (single or multi-photo)
    // ------------------------------------------------------------------
    const attachedMedia: Array<{ media_fbid: string }> = [];

    if (images.length > 0) {
      const photoIds = await Promise.all(
        images.map((img) => uploadUnpublishedPhoto(pageId, accessToken, img.url)),
      );
      attachedMedia.push(...photoIds.map((id) => ({ media_fbid: id })));
    }

    const feedBody: Record<string, unknown> = {
      message: content,
      published: true,
    };

    if (attachedMedia.length > 0) {
      feedBody.attached_media = attachedMedia;
    }

    // Support optional link attachment from platformSettings
    const link = request.platformSettings?.link;
    if (typeof link === "string" && link) {
      feedBody.link = link;
    }

    const feedResponse = await fetch(
      `${GRAPH_BASE}/${pageId}/feed` +
        `?access_token=${encodeURIComponent(accessToken)}&fields=id,permalink_url`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(feedBody),
      },
    );

    const feedData = (await feedResponse.json()) as {
      id?: string;
      permalink_url?: string;
      error?: { message: string; code: number };
    };

    if (feedData.error || !feedData.id) {
      throw new MetaApiError(
        feedData.error?.message ?? "Failed to publish Facebook post",
        feedData.error?.code,
        JSON.stringify(feedData),
      );
    }

    return [
      {
        postId: request.postId,
        platformPostId: feedData.id,
        platformPostUrl:
          feedData.permalink_url ??
          `https://www.facebook.com/${pageId}/posts/${feedData.id}`,
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
        ? JSON.stringify({ message: error.message })
        : typeof error === "string"
          ? error
          : JSON.stringify(error);

    return (
      classifyMetaError(body) ?? {
        type: "retry",
        message:
          error instanceof Error
            ? error.message
            : "An unexpected Facebook error occurred.",
        original: error,
      }
    );
  },

  // -------------------------------------------------------------------------
  // Capabilities
  // -------------------------------------------------------------------------

  getCapabilities() {
    return {
      identifier: "facebook" as const,
      displayName: "Facebook",
      maxContentLength: 63206,
      supportsImages: true,
      supportsVideo: true,
      supportsCarousel: true,
      requiresPageSelection: true,
    };
  },
};

registerProvider(facebookProvider);
