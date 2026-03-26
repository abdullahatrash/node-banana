/**
 * LinkedIn provider adapter.
 *
 * Supports posting to personal profiles and organization pages.
 * Media is uploaded via the LinkedIn REST media upload flow:
 *   1. POST /rest/images?action=initializeUpload  → get uploadUrl + image URN
 *   2. PUT <uploadUrl> with binary image data
 *   3. POST /rest/posts with the image URN in content.media or content.multiImage
 *
 * The OAuth flow uses LinkedIn's authorization code flow with 7 scopes.
 * fetchPageInformation() returns organization pages the user admin.
 *
 * Text content must escape LinkedIn markdown special chars before posting.
 *
 * Env vars: LINKEDIN_CLIENT_ID, LINKEDIN_CLIENT_SECRET
 */

import type {
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
import { makeOAuthState } from "@/lib/social/providers/meta-common";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LINKEDIN_SCOPES = [
  "openid",
  "profile",
  "w_member_social",
  "r_basicprofile",
  "rw_organization_admin",
  "w_organization_social",
  "r_organization_social",
];

const LINKEDIN_AUTH_URL = "https://www.linkedin.com/oauth/v2/authorization";
const LINKEDIN_TOKEN_URL = "https://www.linkedin.com/oauth/v2/accessToken";
const LINKEDIN_API_BASE = "https://api.linkedin.com";

/** LinkedIn API version header value used for REST endpoints. */
const LINKEDIN_VERSION = "202409";

// ---------------------------------------------------------------------------
// Environment helpers
// ---------------------------------------------------------------------------

function getClientId(): string {
  const id = process.env.LINKEDIN_CLIENT_ID;
  if (!id) throw new Error("LINKEDIN_CLIENT_ID environment variable is not set.");
  return id;
}

function getClientSecret(): string {
  const secret = process.env.LINKEDIN_CLIENT_SECRET;
  if (!secret)
    throw new Error("LINKEDIN_CLIENT_SECRET environment variable is not set.");
  return secret;
}

// ---------------------------------------------------------------------------
// Text escaping
// ---------------------------------------------------------------------------

/**
 * Escape LinkedIn markdown special characters in post text.
 *
 * Organisation mention syntax `@[Name](urn:li:organization:id)` is preserved
 * verbatim — only the plain-text regions between mentions are escaped.
 */
function escapeLinkedInText(text: string): string {
  // Preserve existing org mention tokens
  const MENTION_PATTERN = /@\[.+?]\(urn:li:organization.+?\)/g;
  const matches = text.match(MENTION_PATTERN) ?? [];
  const segments = text.split(MENTION_PATTERN);

  const escapedSegments = segments.map((segment) =>
    segment
      .replace(/\\/g, "\\\\")
      .replace(/</g, "\\<")
      .replace(/>/g, "\\>")
      .replace(/#/g, "\\#")
      .replace(/~/g, "\\~")
      .replace(/_/g, "\\_")
      .replace(/\|/g, "\\|")
      .replace(/\[/g, "\\[")
      .replace(/]/g, "\\]")
      .replace(/\*/g, "\\*")
      .replace(/\(/g, "\\(")
      .replace(/\)/g, "\\)")
      .replace(/\{/g, "\\{")
      .replace(/}/g, "\\}")
      .replace(/@/g, "\\@"),
  );

  // Re-interleave escaped segments with original mention tokens
  return escapedSegments.reduce((result, segment, index) => {
    const mention = matches[index] ?? "";
    return result + segment + mention;
  }, "");
}

// ---------------------------------------------------------------------------
// Media upload helpers
// ---------------------------------------------------------------------------

/**
 * Upload a single image to LinkedIn and return its URN.
 *
 * Flow: initialize upload → PUT binary data → return image URN.
 */
async function uploadImage(
  imageUrl: string,
  accessToken: string,
  ownerUrn: string,
): Promise<string> {
  // Step 1: initialize upload
  const initResp = await fetch(
    `${LINKEDIN_API_BASE}/rest/images?action=initializeUpload`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Restli-Protocol-Version": "2.0.0",
        "LinkedIn-Version": LINKEDIN_VERSION,
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        initializeUploadRequest: { owner: ownerUrn },
      }),
    },
  );

  const initData = (await initResp.json()) as {
    value?: { uploadUrl?: string; image?: string };
    message?: string;
    status?: number;
  };

  if (!initData.value?.uploadUrl || !initData.value?.image) {
    throw new LinkedInApiError(
      initData.message ?? "Failed to initialize LinkedIn image upload",
      initData.status,
    );
  }

  const { uploadUrl, image: imageUrn } = initData.value;

  // Step 2: fetch image bytes and upload
  const imageResp = await fetch(imageUrl);
  if (!imageResp.ok) {
    throw new LinkedInApiError(
      `Failed to fetch image from URL: ${imageResp.status} ${imageUrl}`,
    );
  }
  const imageBuffer = Buffer.from(await imageResp.arrayBuffer());

  const uploadResp = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      "LinkedIn-Version": LINKEDIN_VERSION,
      Authorization: `Bearer ${accessToken}`,
    },
    body: imageBuffer,
  });

  if (!uploadResp.ok) {
    throw new LinkedInApiError(
      `LinkedIn image binary upload failed: ${uploadResp.status}`,
      uploadResp.status,
    );
  }

  return imageUrn;
}

// ---------------------------------------------------------------------------
// Post payload builder
// ---------------------------------------------------------------------------

function buildPostPayload(
  authorUrn: string,
  text: string,
  imageUrns: string[],
): Record<string, unknown> {
  const base = {
    author: authorUrn,
    commentary: escapeLinkedInText(text),
    visibility: "PUBLIC",
    distribution: {
      feedDistribution: "MAIN_FEED",
      targetEntities: [] as string[],
      thirdPartyDistributionChannels: [] as string[],
    },
    lifecycleState: "PUBLISHED",
    isReshareDisabledByAuthor: false,
  };

  if (imageUrns.length === 0) {
    return base;
  }

  if (imageUrns.length === 1) {
    return {
      ...base,
      content: {
        media: { id: imageUrns[0] },
      },
    };
  }

  return {
    ...base,
    content: {
      multiImage: {
        images: imageUrns.map((id) => ({ id })),
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Custom error type
// ---------------------------------------------------------------------------

export class LinkedInApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "LinkedInApiError";
  }
}

// ---------------------------------------------------------------------------
// Provider implementation
// ---------------------------------------------------------------------------

export const linkedInProvider: SocialProviderAdapter = {
  identifier: "linkedin",
  displayName: "LinkedIn",
  maxContentLength: 3000,
  supportsImages: true,
  supportsVideo: false,
  supportsCarousel: true,
  maxImages: 9,
  maxConcurrentJobs: 2,
  requiresPageSelection: true,

  // -------------------------------------------------------------------------
  // OAuth
  // -------------------------------------------------------------------------

  async generateAuthUrl(callbackUrl: string): Promise<GenerateAuthUrlResult> {
    const state = makeOAuthState(16);
    const url =
      LINKEDIN_AUTH_URL +
      `?response_type=code` +
      `&client_id=${encodeURIComponent(getClientId())}` +
      `&redirect_uri=${encodeURIComponent(callbackUrl)}` +
      `&state=${state}` +
      `&scope=${encodeURIComponent(LINKEDIN_SCOPES.join(" "))}`;

    return { url, state };
  },

  async authenticate(params: {
    code: string;
    codeVerifier?: string;
    state?: string;
  }): Promise<AuthenticateResult> {
    const redirectUri = params.codeVerifier ?? "";

    const tokenBody = new URLSearchParams({
      grant_type: "authorization_code",
      code: params.code,
      redirect_uri: redirectUri,
      client_id: getClientId(),
      client_secret: getClientSecret(),
    });

    const tokenResp = await fetch(LINKEDIN_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: tokenBody,
    });

    const tokenData = (await tokenResp.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      error?: string;
      error_description?: string;
    };

    if (!tokenData.access_token) {
      throw new LinkedInApiError(
        tokenData.error_description ?? tokenData.error ?? "LinkedIn token exchange failed",
      );
    }

    const { access_token: accessToken, refresh_token: refreshToken, expires_in: expiresIn } =
      tokenData;

    // Fetch user profile via userinfo endpoint (OIDC-compatible)
    const profileResp = await fetch(`${LINKEDIN_API_BASE}/v2/userinfo`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const profile = (await profileResp.json()) as {
      sub?: string;
      name?: string;
      picture?: string;
    };

    return {
      platformUserId: profile.sub ?? "",
      accessToken,
      refreshToken: refreshToken ?? undefined,
      expiresIn: expiresIn ?? undefined,
      displayName: profile.name ?? "",
      avatarUrl: profile.picture ?? undefined,
      requiresPageSelection: true,
    };
  },

  async refreshToken(refreshTokenValue: string): Promise<RefreshTokenResult> {
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshTokenValue,
      client_id: getClientId(),
      client_secret: getClientSecret(),
    });

    const resp = await fetch(LINKEDIN_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });

    const data = (await resp.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      error?: string;
      error_description?: string;
    };

    if (!data.access_token) {
      throw new LinkedInApiError(
        data.error_description ?? data.error ?? "LinkedIn token refresh failed",
      );
    }

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token ?? undefined,
      expiresIn: data.expires_in ?? undefined,
    };
  },

  // -------------------------------------------------------------------------
  // Page / org selection
  // -------------------------------------------------------------------------

  async fetchPageInformation(accessToken: string): Promise<PageInfo[]> {
    // Fetch organizations where the user has ADMINISTRATOR role
    const resp = await fetch(
      `${LINKEDIN_API_BASE}/v2/organizationAcls` +
        `?q=roleAssignee&role=ADMINISTRATOR&state=APPROVED` +
        `&projection=(elements*(organization~(id,localizedName,logoV2(original~:playableStreams))))`,
      {
        headers: {
          "X-Restli-Protocol-Version": "2.0.0",
          "LinkedIn-Version": LINKEDIN_VERSION,
          Authorization: `Bearer ${accessToken}`,
        },
      },
    );

    const data = (await resp.json()) as {
      elements?: Array<{
        "organization~"?: {
          id?: number;
          localizedName?: string;
          logoV2?: {
            "original~"?: {
              elements?: Array<{
                identifiers?: Array<{ identifier?: string }>;
              }>;
            };
          };
        };
      }>;
      message?: string;
      status?: number;
    };

    if (!data.elements) {
      // Gracefully handle cases where the user has no admin orgs
      return [];
    }

    const pages: PageInfo[] = [];
    for (const el of data.elements) {
      const org = el["organization~"];
      if (!org?.id) continue;

      const logoUrl =
        org.logoV2?.["original~"]?.elements?.[0]?.identifiers?.[0]?.identifier ?? undefined;

      pages.push({
        id: String(org.id),
        name: org.localizedName ?? String(org.id),
        picture: logoUrl,
      });
    }
    return pages;
  },

  // -------------------------------------------------------------------------
  // Publishing
  // -------------------------------------------------------------------------

  async post(
    platformUserId: string,
    accessToken: string,
    requests: PublishRequest[],
  ): Promise<PublishResult[]> {
    const [request] = requests;
    if (!request) return [];

    // Determine author URN — platformUserId may be a person or org ID.
    // Convention: if platformSettings.type === "organization", use org URN.
    const isOrg = request.platformSettings?.type === "organization";
    const authorUrn = isOrg
      ? `urn:li:organization:${platformUserId}`
      : `urn:li:person:${platformUserId}`;

    // Upload all images
    const images = (request.media ?? []).filter((m) => m.type === "image");
    const imageUrns = await Promise.all(
      images.map((img) => uploadImage(img.url, accessToken, authorUrn)),
    );

    const payload = buildPostPayload(authorUrn, request.content, imageUrns);

    const postResp = await fetch(`${LINKEDIN_API_BASE}/rest/posts`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Restli-Protocol-Version": "2.0.0",
        "LinkedIn-Version": LINKEDIN_VERSION,
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(payload),
    });

    if (postResp.status !== 201 && postResp.status !== 200) {
      const errorBody = await postResp.text();
      throw new LinkedInApiError(
        `LinkedIn post creation failed: ${postResp.status} — ${errorBody}`,
        postResp.status,
      );
    }

    // LinkedIn returns the post URN in the x-restli-id header
    const postUrn = postResp.headers.get("x-restli-id") ?? "";
    const platformPostUrl = `https://www.linkedin.com/feed/update/${encodeURIComponent(postUrn)}`;

    return [
      {
        postId: request.postId,
        platformPostId: postUrn,
        platformPostUrl,
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

    // 401 / expired token
    if (
      body.includes("401") ||
      body.includes("Unauthorized") ||
      body.includes("token") && body.includes("expired")
    ) {
      return {
        type: "refresh-token",
        message: "LinkedIn access token expired. Please re-authenticate.",
        original: error,
      };
    }

    // 429 rate limit
    if (body.includes("429") || body.includes("Too Many Requests")) {
      return {
        type: "retry",
        message: "LinkedIn rate limit reached. Will retry shortly.",
        original: error,
      };
    }

    // Bad payload / content issues
    if (
      body.includes("INVALID_REQUEST") ||
      body.includes("400") ||
      body.includes("invalid") ||
      body.includes("not allowed") ||
      body.includes("violates") ||
      body.includes("bad-body")
    ) {
      return {
        type: "bad-body",
        message:
          error instanceof Error
            ? error.message
            : "The post content was rejected by LinkedIn.",
        original: error,
      };
    }

    // Transient LinkedIn errors
    if (
      body.includes("Unable to obtain activity") ||
      body.includes("resource is forbidden")
    ) {
      return {
        type: "retry",
        message: body,
        original: error,
      };
    }

    return {
      type: "retry",
      message:
        error instanceof Error ? error.message : "An unexpected LinkedIn error occurred.",
      original: error,
    };
  },

  // -------------------------------------------------------------------------
  // Capabilities
  // -------------------------------------------------------------------------

  getCapabilities(): ProviderCapabilities {
    return {
      identifier: "linkedin",
      displayName: "LinkedIn",
      maxContentLength: 3000,
      supportsImages: true,
      supportsVideo: false,
      supportsCarousel: true,
      requiresPageSelection: true,
    };
  },
};

// Register at module load time
registerProvider(linkedInProvider);
