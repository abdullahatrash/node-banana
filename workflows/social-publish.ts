/**
 * Durable publish workflow for the Social Hub.
 *
 * Uses Vercel Workflow Development Kit (WDK) with:
 * - 'use workflow' for durable, resumable execution
 * - 'use step' for retriable units of work (auto 3x retry)
 * - sleep() for scheduled posts (zero compute while waiting)
 * - FatalError to skip retries on non-recoverable errors
 *
 * Flow: loadPost → sleep (if scheduled) → refreshToken → processMedia → publish → finalize
 */

import { sleep, FatalError } from "workflow";

// ---------------------------------------------------------------------------
// Workflow
// ---------------------------------------------------------------------------

export async function publishPostWorkflow(
  postId: string,
  workspaceId: string,
) {
  "use workflow";

  // Step 1: Load the post and transition to "publishing"
  const post = await loadPost(postId, workspaceId);

  // Step 2: If scheduled for the future, sleep until publish time
  if (post.scheduledAt) {
    const scheduledTime = new Date(post.scheduledAt).getTime();
    const now = Date.now();
    if (scheduledTime > now) {
      const delayMs = scheduledTime - now;
      await sleep(delayMs);
    }
  }

  // Step 3: Refresh token if expiring soon
  const account = await refreshTokenStep(post.socialAccountId);

  // Step 4: Process media for the target platform
  const processedMedia = await processMediaStep(
    post.mediaUrls,
    account.platform,
  );

  // Step 5: Publish to the provider
  const result = await publishStep(
    postId,
    post.content,
    processedMedia,
    account,
  );

  // Step 6: Finalize — update post with platform URL
  await finalizeStep(postId, result);

  return result;
}

// ---------------------------------------------------------------------------
// Steps (each is an isolated, retriable unit of work)
// ---------------------------------------------------------------------------

interface PostData {
  id: string;
  content: string | null;
  mediaUrls: Array<{ type: string; url: string; alt?: string }> | null;
  socialAccountId: string;
  scheduledAt: string | null;
}

async function loadPost(
  postId: string,
  workspaceId: string,
): Promise<PostData> {
  "use step";

  const { getSocialPost, updatePostStatus } = await import(
    "@/lib/social/repository"
  );

  const post = await getSocialPost(workspaceId, postId);

  // Transition to "publishing"
  await updatePostStatus(postId, "publishing");

  return {
    id: post.id,
    content: post.content,
    mediaUrls: post.mediaUrls,
    socialAccountId: post.socialAccountId,
    scheduledAt: post.scheduledAt?.toISOString() ?? null,
  };
}

interface AccountData {
  id: string;
  platform: string;
  platformUserId: string;
  accessTokenEncrypted: string;
  refreshTokenEncrypted: string | null;
  accessTokenSecret: string | null;
  tokenExpiresAt: string | null;
}

const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000; // 5 minutes

async function refreshTokenStep(
  accountId: string,
): Promise<AccountData> {
  "use step";

  const { getSocialAccountById, updateSocialAccountTokens, markRequiresReauth } =
    await import("@/lib/social/repository");
  const { decryptToken, encryptToken } = await import("@/lib/social/crypto");
  const { getProvider } = await import("@/lib/social/provider-registry");

  const account = await getSocialAccountById(accountId);

  // Check if token needs refresh
  const needsRefresh =
    account.tokenExpiresAt &&
    new Date(account.tokenExpiresAt).getTime() <
      Date.now() + TOKEN_REFRESH_BUFFER_MS;

  if (needsRefresh && account.refreshTokenEncrypted) {
    const provider = getProvider(account.platform);
    try {
      const refreshToken = decryptToken(account.refreshTokenEncrypted);
      const refreshed = await provider.refreshToken(refreshToken);

      await updateSocialAccountTokens(accountId, {
        accessTokenEncrypted: encryptToken(refreshed.accessToken),
        refreshTokenEncrypted: refreshed.refreshToken
          ? encryptToken(refreshed.refreshToken)
          : undefined,
        tokenExpiresAt: refreshed.expiresIn
          ? new Date(Date.now() + refreshed.expiresIn * 1000)
          : undefined,
      });

      return {
        id: account.id,
        platform: account.platform,
        platformUserId: account.platformUserId,
        accessTokenEncrypted: encryptToken(refreshed.accessToken),
        refreshTokenEncrypted: refreshed.refreshToken
          ? encryptToken(refreshed.refreshToken)
          : (account.refreshTokenEncrypted ?? null),
        accessTokenSecret: account.accessTokenSecret,
        tokenExpiresAt: refreshed.expiresIn
          ? new Date(Date.now() + refreshed.expiresIn * 1000).toISOString()
          : null,
      };
    } catch {
      // Token refresh failed — mark account for re-auth
      await markRequiresReauth(accountId);
      throw new FatalError(
        "Token refresh failed. Please reconnect your account.",
      );
    }
  }

  return {
    id: account.id,
    platform: account.platform,
    platformUserId: account.platformUserId,
    accessTokenEncrypted: account.accessTokenEncrypted,
    refreshTokenEncrypted: account.refreshTokenEncrypted,
    accessTokenSecret: account.accessTokenSecret,
    tokenExpiresAt: account.tokenExpiresAt?.toISOString() ?? null,
  };
}

interface ProcessedMediaItem {
  type: "image" | "video";
  url: string;
  mimeType: string;
  alt?: string;
}

async function processMediaStep(
  mediaUrls: Array<{ type: string; url: string; alt?: string }> | null,
  platform: string,
): Promise<ProcessedMediaItem[]> {
  "use step";

  if (!mediaUrls || mediaUrls.length === 0) {
    return [];
  }

  const { validateMediaConstraints } = await import("@/lib/social/media");
  type SocialPlatform = import("@/lib/db/schema").SocialPlatform;

  // Validate constraints
  const items = mediaUrls.map((m) => ({
    type: m.type as "image" | "video",
    url: m.url,
    alt: m.alt,
  }));

  const validation = validateMediaConstraints(
    platform as SocialPlatform,
    items,
  );

  if (!validation.valid) {
    throw new FatalError(
      `Media validation failed: ${validation.errors.join("; ")}`,
    );
  }

  // For now, pass media through as-is.
  // Full processing (resize, format convert) happens in the provider's post() method
  // or can be expanded here when needed.
  return items.map((m) => ({
    type: m.type,
    url: m.url,
    mimeType: m.type === "video" ? "video/mp4" : "image/jpeg",
    alt: m.alt,
  }));
}

interface PublishResultData {
  platformPostId: string;
  platformPostUrl: string;
}

async function publishStep(
  postId: string,
  content: string | null,
  media: ProcessedMediaItem[],
  account: AccountData,
): Promise<PublishResultData> {
  "use step";

  const { getProvider } = await import("@/lib/social/provider-registry");
  const { decryptToken } = await import("@/lib/social/crypto");
  const { updatePostStatus, markRequiresReauth } = await import(
    "@/lib/social/repository"
  );

  const provider = getProvider(account.platform);
  const accessToken = decryptToken(account.accessTokenEncrypted);
  const accessTokenSecret = account.accessTokenSecret
    ? decryptToken(account.accessTokenSecret)
    : undefined;

  try {
    const results = await provider.post(
      account.platformUserId,
      accessToken,
      [
        {
          postId,
          content: content || "",
          media: media.length > 0 ? media : undefined,
        },
      ],
      { accessTokenSecret },
    );

    const result = results[0];
    if (!result) {
      throw new Error("Provider returned no result");
    }

    return {
      platformPostId: result.platformPostId,
      platformPostUrl: result.platformPostUrl,
    };
  } catch (error) {
    // Classify the error to determine retry behavior
    const classified = provider.classifyError(error);

    if (classified.type === "bad-body") {
      // Non-recoverable — content is invalid
      await updatePostStatus(postId, "failed", {
        errorMessage: classified.message,
      });
      throw new FatalError(classified.message);
    }

    if (classified.type === "refresh-token") {
      // Token is invalid — mark for re-auth and fail
      await markRequiresReauth(account.id);
      await updatePostStatus(postId, "failed", {
        errorMessage:
          "Authentication expired. Please reconnect your account.",
      });
      throw new FatalError("Token expired — requires re-authentication");
    }

    // "retry" — transient error, let WDK auto-retry (up to 3x)
    throw error;
  }
}

async function finalizeStep(
  postId: string,
  result: PublishResultData,
): Promise<void> {
  "use step";

  const { updatePostStatus } = await import("@/lib/social/repository");

  await updatePostStatus(postId, "published", {
    platformPostId: result.platformPostId,
    platformPostUrl: result.platformPostUrl,
    publishedAt: new Date(),
  });
}
