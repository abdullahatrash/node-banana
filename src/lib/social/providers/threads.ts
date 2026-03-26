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
import { registerProvider } from "@/lib/social/provider-registry";

const SCOPES = [
  "threads_basic",
  "threads_content_publish",
  "threads_manage_insights",
  "pages_show_list",
  "business_management",
];

async function fetchThreadPermalink(
  threadPostId: string,
  accessToken: string,
): Promise<string> {
  const url =
    `${GRAPH_BASE}/${threadPostId}` +
    `?fields=id,permalink&access_token=${encodeURIComponent(accessToken)}`;
  const response = await fetch(url);
  const data = (await response.json()) as {
    id?: string;
    permalink?: string;
    error?: { message?: string; code?: number };
  };

  if (data.error) {
    throw new MetaApiError(
      data.error.message ?? "Failed to fetch Threads permalink",
      data.error.code,
      JSON.stringify(data),
    );
  }

  return data.permalink ?? `https://www.threads.net/t/${threadPostId}`;
}

export const threadsProvider: SocialProviderAdapter = {
  identifier: "threads",
  displayName: "Threads",
  maxContentLength: 500,
  supportsImages: false,
  supportsVideo: false,
  supportsCarousel: false,
  maxImages: 0,
  maxConcurrentJobs: 5,
  requiresPageSelection: true,

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
    const shortToken = await exchangeCodeForToken(params.code, params.redirectUri);
    const longToken = await exchangeForLongLivedToken(shortToken.access_token);

    await verifyGrantedScopes(longToken.access_token, SCOPES);

    const profileUrl =
      `${GRAPH_BASE}/me` +
      `?fields=id,name,picture&access_token=${encodeURIComponent(longToken.access_token)}`;
    const profileResponse = await fetch(profileUrl);
    const profile = (await profileResponse.json()) as {
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
      username: "",
      avatarUrl: profile.picture?.data?.url ?? "",
      requiresPageSelection: true,
    };
  },

  async refreshToken(refreshToken: string): Promise<RefreshTokenResult> {
    // Meta long-lived tokens are refreshed by re-auth in practice.
    return { accessToken: refreshToken };
  },

  async fetchPageInformation(accessToken: string): Promise<PageInfo[]> {
    const response = await fetch(
      `${GRAPH_BASE}/me/accounts` +
        `?fields=id,name,access_token,` +
        `instagram_business_account{id,username,profile_picture_url,threads_profile{id,username,profile_picture_url}}` +
        `&limit=100&access_token=${encodeURIComponent(accessToken)}`,
    );

    const data = (await response.json()) as {
      data?: Array<{
        id: string;
        name: string;
        access_token?: string;
        instagram_business_account?: {
          id?: string;
          username?: string;
          profile_picture_url?: string;
          threads_profile?: {
            id?: string;
            username?: string;
            profile_picture_url?: string;
          };
        };
      }>;
      error?: { message?: string; code?: number };
    };

    if (data.error) {
      throw new MetaApiError(
        data.error.message ?? "Failed to fetch Threads pages",
        data.error.code,
        JSON.stringify(data),
      );
    }

    const pages: PageInfo[] = [];
    for (const page of data.data ?? []) {
      const threads = page.instagram_business_account?.threads_profile;
      if (!threads?.id) {
        continue;
      }

      pages.push({
        id: threads.id,
        name: threads.username || page.name || "Threads Profile",
        username: threads.username,
        picture:
          threads.profile_picture_url ||
          page.instagram_business_account?.profile_picture_url,
        accessToken: page.access_token,
      });
    }

    return pages;
  },

  async post(
    platformUserId: string,
    accessToken: string,
    requests: PublishRequest[],
  ): Promise<PublishResult[]> {
    const results: PublishResult[] = [];

    for (const request of requests) {
      if (request.media?.length) {
        throw new Error(
          "Threads provider currently supports text-only posts in this release.",
        );
      }

      const content = request.content.trim();
      if (!content) {
        throw new Error("Threads post content cannot be empty.");
      }

      const createParams = new URLSearchParams({
        media_type: "TEXT",
        text: content,
        access_token: accessToken,
      });
      const link =
        typeof request.platformSettings?.link === "string"
          ? request.platformSettings.link.trim()
          : "";
      if (link) {
        createParams.set("link_attachment_url", link);
      }

      const createResponse = await fetch(
        `${GRAPH_BASE}/${platformUserId}/threads?${createParams.toString()}`,
        { method: "POST" },
      );
      const createData = (await createResponse.json()) as {
        id?: string;
        error?: { message?: string; code?: number };
      };
      if (createData.error || !createData.id) {
        throw new MetaApiError(
          createData.error?.message ?? "Failed to create Threads post container",
          createData.error?.code,
          JSON.stringify(createData),
        );
      }

      const publishParams = new URLSearchParams({
        creation_id: createData.id,
        access_token: accessToken,
      });
      const publishResponse = await fetch(
        `${GRAPH_BASE}/${platformUserId}/threads_publish?${publishParams.toString()}`,
        { method: "POST" },
      );
      const publishData = (await publishResponse.json()) as {
        id?: string;
        error?: { message?: string; code?: number };
      };
      if (publishData.error || !publishData.id) {
        throw new MetaApiError(
          publishData.error?.message ?? "Failed to publish Threads post",
          publishData.error?.code,
          JSON.stringify(publishData),
        );
      }

      const permalink = await fetchThreadPermalink(publishData.id, accessToken);
      results.push({
        postId: request.postId,
        platformPostId: publishData.id,
        platformPostUrl: permalink,
        status: "published",
      });
    }

    return results;
  },

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
            : "An unexpected Threads error occurred.",
        original: error,
      }
    );
  },

  getCapabilities() {
    return {
      identifier: "threads" as const,
      displayName: "Threads",
      maxContentLength: 500,
      supportsImages: false,
      supportsVideo: false,
      supportsCarousel: false,
      requiresPageSelection: true,
    };
  },
};

registerProvider(threadsProvider);
