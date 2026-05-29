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

/**
 * Token bundle stored for each Mastodon account.
 * Because Mastodon is federated, we must record the instance URL alongside
 * the access token so every subsequent API call hits the correct host.
 */
interface MastodonTokenBundle {
  accessToken: string;
  instanceUrl: string;
}

/**
 * Per-instance OAuth credentials that arrive via the `codeVerifier` field
 * during the authenticate() call. The client initiates a custom connect
 * route that registers an application on the specific instance, then passes
 * the resulting credentials here.
 */
interface MastodonCodeVerifier {
  instanceUrl: string;
  clientId: string;
  clientSecret: string;
}

function parseTokenBundle(raw: string): MastodonTokenBundle {
  try {
    const bundle = JSON.parse(raw) as Partial<MastodonTokenBundle>;
    if (!bundle.accessToken || !bundle.instanceUrl) {
      throw new Error("Missing accessToken or instanceUrl in token bundle");
    }
    return bundle as MastodonTokenBundle;
  } catch {
    throw new Error("Mastodon token bundle is malformed JSON");
  }
}

function parseCodeVerifier(raw: string): MastodonCodeVerifier {
  try {
    const cv = JSON.parse(raw) as Partial<MastodonCodeVerifier>;
    if (!cv.instanceUrl || !cv.clientId || !cv.clientSecret) {
      throw new Error("codeVerifier must contain instanceUrl, clientId, and clientSecret");
    }
    return cv as MastodonCodeVerifier;
  } catch {
    throw new Error("Mastodon codeVerifier is malformed or missing required fields");
  }
}

export const mastodonProvider: SocialProviderAdapter = {
  identifier: "mastodon",
  displayName: "Mastodon",
  maxContentLength: 500,
  supportsImages: true,
  supportsVideo: false,
  supportsCarousel: false,
  maxImages: 4,
  maxConcurrentJobs: 5,
  requiresPageSelection: false,

  /**
   * Mastodon uses per-instance OAuth — there is no single global authorization
   * URL. Callers must use the custom /connect/mastodon route instead.
   */
  async generateAuthUrl(_callbackUrl: string): Promise<GenerateAuthUrlResult> {
    throw new Error(
      "Mastodon uses per-instance OAuth. Use the /connect/mastodon route to initiate authentication.",
    );
  },

  async authenticate(params: AuthenticateParams): Promise<AuthenticateResult> {
    if (!params.codeVerifier) {
      throw new Error("Mastodon authenticate requires codeVerifier with instanceUrl, clientId, and clientSecret");
    }

    const { instanceUrl, clientId, clientSecret } = parseCodeVerifier(params.codeVerifier);

    // Exchange authorization code for access token
    const tokenResponse = await fetch(`${instanceUrl}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: params.code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: params.redirectUri,
        scope: "read write",
      }),
    });

    if (!tokenResponse.ok) {
      const body = await tokenResponse.text();
      throw new Error(`Mastodon token exchange failed: ${tokenResponse.status} ${body}`);
    }

    const tokens = (await tokenResponse.json()) as {
      access_token?: string;
      token_type?: string;
    };

    if (!tokens.access_token) {
      throw new Error("Mastodon token exchange returned no access_token");
    }

    // Fetch the authenticated user's profile
    const profileResponse = await fetch(`${instanceUrl}/api/v1/accounts/verify_credentials`, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });

    if (!profileResponse.ok) {
      const body = await profileResponse.text();
      throw new Error(`Mastodon profile fetch failed: ${profileResponse.status} ${body}`);
    }

    const profile = (await profileResponse.json()) as {
      id?: string;
      username?: string;
      display_name?: string;
      avatar?: string;
      acct?: string;
    };

    if (!profile.id) {
      throw new Error("Mastodon profile response missing id");
    }

    const tokenBundle: MastodonTokenBundle = {
      accessToken: tokens.access_token,
      instanceUrl,
    };

    return {
      platformUserId: profile.id,
      accessToken: JSON.stringify(tokenBundle),
      displayName: profile.display_name || profile.username || profile.acct || profile.id,
      username: profile.username,
      avatarUrl: profile.avatar,
      requiresPageSelection: false,
    };
  },

  /**
   * Mastodon access tokens do not expire on most instances.
   * This is a no-op that returns the same token from the stored bundle.
   */
  async refreshToken(refreshToken: string): Promise<RefreshTokenResult> {
    const bundle = parseTokenBundle(refreshToken);
    return {
      accessToken: bundle.accessToken,
    };
  },

  async post(
    _platformUserId: string,
    accessToken: string,
    requests: PublishRequest[],
  ): Promise<PublishResult[]> {
    const bundle = parseTokenBundle(accessToken);
    const results: PublishResult[] = [];

    for (const request of requests) {
      const settings = request.platformSettings ?? {};
      const visibility =
        typeof settings.visibility === "string" ? settings.visibility : "public";
      const contentWarning =
        typeof settings.contentWarning === "string" ? settings.contentWarning : undefined;

      // Upload images if present
      const mediaIds: string[] = [];
      if (request.media && request.media.length > 0) {
        const images = request.media.filter((m) => m.type === "image").slice(0, 4);
        for (const image of images) {
          const mediaId = await uploadMastodonMedia(bundle, image.url, image.alt, image.mimeType);
          mediaIds.push(mediaId);
        }
      }

      const statusBody: Record<string, unknown> = {
        status: request.content,
        visibility,
      };
      if (contentWarning) {
        statusBody.spoiler_text = contentWarning;
      }
      if (mediaIds.length > 0) {
        statusBody.media_ids = mediaIds;
      }

      const response = await fetch(`${bundle.instanceUrl}/api/v1/statuses`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${bundle.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(statusBody),
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`Mastodon post failed: ${response.status} ${body}`);
      }

      const data = (await response.json()) as {
        id?: string;
        url?: string;
      };

      if (!data.id) {
        throw new Error("Mastodon post response missing id");
      }

      results.push({
        postId: request.postId,
        platformPostId: data.id,
        platformPostUrl: data.url ?? `${bundle.instanceUrl}/statuses/${data.id}`,
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
      lower.includes("invalid_token") ||
      (lower.includes("token") && lower.includes("expired"))
    ) {
      return {
        type: "refresh-token",
        message: "Mastodon authentication expired. Please reconnect your account.",
        original: error,
      };
    }

    if (
      lower.includes("422") ||
      lower.includes("unprocessable") ||
      lower.includes("400") ||
      lower.includes("bad request") ||
      lower.includes("content too long") ||
      lower.includes("validation")
    ) {
      return {
        type: "bad-body",
        message,
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
        message: "Mastodon is temporarily unavailable or rate-limited. Will retry.",
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
      identifier: "mastodon",
      displayName: "Mastodon",
      maxContentLength: 500,
      supportsImages: true,
      supportsVideo: false,
      supportsCarousel: false,
      requiresPageSelection: false,
    };
  },
};

/**
 * Upload a single image to the Mastodon instance's media API.
 * Downloads the image from the provided URL, then POSTs it as multipart/form-data.
 */
async function uploadMastodonMedia(
  bundle: MastodonTokenBundle,
  imageUrl: string,
  alt?: string,
  mimeType?: string,
): Promise<string> {
  const imageResponse = await fetch(imageUrl);
  if (!imageResponse.ok) {
    throw new Error(`Failed to download image for Mastodon upload: ${imageResponse.status}`);
  }

  const imageBlob = await imageResponse.blob();
  const form = new FormData();
  form.append("file", imageBlob, `upload.${mimeType?.split("/")[1] ?? "jpg"}`);
  if (alt) {
    form.append("description", alt);
  }

  const uploadResponse = await fetch(`${bundle.instanceUrl}/api/v2/media`, {
    method: "POST",
    headers: { Authorization: `Bearer ${bundle.accessToken}` },
    body: form,
  });

  if (!uploadResponse.ok) {
    const body = await uploadResponse.text();
    throw new Error(`Mastodon media upload failed: ${uploadResponse.status} ${body}`);
  }

  const media = (await uploadResponse.json()) as { id?: string };
  if (!media.id) {
    throw new Error("Mastodon media upload response missing id");
  }

  return media.id;
}

registerProvider(mastodonProvider);
