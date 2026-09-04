/**
 * Durable publish workflow for the Social Hub.
 *
 * Uses Vercel Workflow Development Kit (WDK) with:
 * - 'use workflow' for durable, resumable execution
 * - 'use step' for retriable units of work (auto 3x retry)
 * - sleep() for scheduled posts (zero compute while waiting)
 * - FatalError to skip retries on non-recoverable errors
 *
 * Flow: loadPost → sleep (if scheduled) → refreshToken → publish verified stable media → finalize
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

  return publishSinglePostWorkflow(postId, workspaceId);
}

export async function publishPostChainWorkflow(
  rootPostId: string,
  workspaceId: string,
) {
  "use workflow";

  const rootResult = await publishSinglePostWorkflow(rootPostId, workspaceId);
  const chainChildren = await loadChainChildren(rootPostId, workspaceId);

  let cumulativeDelayMs = 0;
  const chainAnchorMs = Date.now();

  for (const child of chainChildren) {
    if (child.status === "published") {
      continue;
    }
    if (child.status === "publishing") {
      continue;
    }

    cumulativeDelayMs += Math.max(0, child.delaySeconds ?? 0) * 1000;
    const chainedTargetMs = chainAnchorMs + cumulativeDelayMs;
    const scheduledTargetMs = child.scheduledAt
      ? new Date(child.scheduledAt).getTime()
      : null;
    const targetMs =
      scheduledTargetMs && Number.isFinite(scheduledTargetMs)
        ? Math.max(chainedTargetMs, scheduledTargetMs)
        : chainedTargetMs;
    const waitMs = targetMs - Date.now();
    if (waitMs > 0) {
      await sleep(waitMs);
    }

    await queueChainChildStep({
      rootPostId,
      childPostId: child.id,
      workspaceId,
      socialAccountId: child.socialAccountId,
      previousStatus: child.status,
      position: child.position,
      delaySeconds: child.delaySeconds,
    });
    await publishSinglePostWorkflow(child.id, workspaceId);
  }

  return rootResult;
}

async function publishSinglePostWorkflow(
  postId: string,
  workspaceId: string,
) {
  await assertPublishingRegionStep(workspaceId);
  // Step 1: Load the post and transition to "publishing"
  let post = await loadPost(postId, workspaceId);

  // Step 2: If scheduled for the future, sleep until publish time.
  // Reload after every sleep so reschedules and force-publish runs win over
  // stale workflow state.
  post = await waitForPublishWindow(postId, workspaceId, post);

  // Step 3: Refresh token if expiring soon
  const account = await refreshTokenStep(post.socialAccountId);

  // Step 4: Publish to the provider. Media is re-read, hash-verified, and
  // resolved from stable Workspace references inside the provider-effect step.
  const result = await publishStep(
    postId,
    post.content,
    account,
    post.platformSettings,
  );

  // Step 5: Finalize — update post with platform URL
  await finalizeStep(
    {
      id: post.id,
      workspaceId: post.workspaceId,
      socialAccountId: post.socialAccountId,
    },
    { platform: account.platform },
    result,
  );

  return result;
}

async function assertPublishingRegionStep(workspaceId: string): Promise<void> {
  "use step";
  const {
    GOVERNANCE_REGION_ROUTES,
    requireGovernanceRegionRoute,
  } = await import("@/lib/governance/region-enforcement");
  await requireGovernanceRegionRoute({
    workspaceId,
    route: GOVERNANCE_REGION_ROUTES.publishing,
    configuredRegion:
      process.env.SOCIAL_PROCESSING_REGION ?? process.env.APP_DATA_REGION,
  });
}

async function waitForPublishWindow(
  postId: string,
  workspaceId: string,
  initialPost: PostData,
): Promise<PostData> {
  let post = initialPost;

  while (post.scheduledAt) {
    const scheduledTime = new Date(post.scheduledAt).getTime();
    const delayMs = scheduledTime - Date.now();
    if (delayMs <= 0) {
      break;
    }

    await sleep(delayMs);
    post = await reloadPostBeforePublish(postId, workspaceId);
  }

  return reloadPostBeforePublish(postId, workspaceId);
}

interface ChainChildData {
  id: string;
  workspaceId: string;
  socialAccountId: string;
  status: string;
  scheduledAt: string | null;
  delaySeconds: number | null;
  position: number | null;
}

async function loadChainChildren(
  rootPostId: string,
  workspaceId: string,
): Promise<ChainChildData[]> {
  "use step";

  const { listOrderedChainChildren } = await import("@/lib/social/repository");

  const rows = await listOrderedChainChildren(workspaceId, rootPostId);
  return rows.map((row) => ({
    id: row.id,
    workspaceId: row.workspaceId,
    socialAccountId: row.socialAccountId,
    status: row.status,
    scheduledAt: row.scheduledAt?.toISOString() ?? null,
    delaySeconds: row.delaySeconds ?? null,
    position: row.position ?? null,
  }));
}

async function queueChainChildStep(input: {
  rootPostId: string;
  childPostId: string;
  workspaceId: string;
  socialAccountId: string;
  previousStatus: string;
  position: number | null;
  delaySeconds: number | null;
}) {
  "use step";

  const { updatePostStatus } = await import("@/lib/social/repository");
  const { emitSocialEvent } = await import("@/lib/social/events");

  await updatePostStatus(input.childPostId, "queued", {
    errorMessage: null,
    retryCount: input.previousStatus === "failed" ? 0 : undefined,
    dispatchStatus: "dispatched",
    workflowRunRef: `chain:${input.rootPostId}`,
    nextDispatchAt: null,
    lastDispatchError: null,
    lockedAt: null,
  });

  await emitSocialEvent({
    workspaceId: input.workspaceId,
    eventType: "post.queued",
    severity: "info",
    message: "Chain child post queued for publishing.",
    postId: input.childPostId,
    accountId: input.socialAccountId,
    metadata: {
      rootPostId: input.rootPostId,
      position: input.position,
      delaySeconds: input.delaySeconds,
    },
  });
}

// ---------------------------------------------------------------------------
// Steps (each is an isolated, retriable unit of work)
// ---------------------------------------------------------------------------

interface PostData {
  id: string;
  workspaceId: string;
  content: string | null;
  mediaUrls: Array<{ type: string; url: string; alt?: string }> | null;
  stableMediaRefs: Array<{ resourceKind?: "studio_asset" | "artifact"; assetId: string; assetDigest: string; order: number; alt?: string }>;
  platformSettings: Record<string, unknown> | null;
  socialAccountId: string;
  scheduledAt: string | null;
  status: string;
  triggerSource: string | null;
  createdByUserId: string | null;
}

async function assertGovernedPublishingStep(post: PostData): Promise<void> {
  "use step";
  return verifyGovernedPublishing(post);
}

async function verifyGovernedPublishing(post: PostData): Promise<void> {
  const { requiresGovernedPublishingPlan } = await import("@/lib/governance/publishing-route-guard");
  if (!(await requiresGovernedPublishingPlan(post.workspaceId))) return;
  const { parseGovernedPublishingMarker, PRODUCTION_SOCIAL_PUBLISHING_APPROVAL_ADMISSION } = await import("@/lib/agent-tools/social-publishing-approval");
  const marker = parseGovernedPublishingMarker(post.triggerSource);
  if (!marker) throw new FatalError("Governed Publishing Approval is missing its actor binding.");
  const valid = await PRODUCTION_SOCIAL_PUBLISHING_APPROVAL_ADMISSION.verifyConsumed({
    workspaceId: post.workspaceId,
    socialAccountId: post.socialAccountId,
    actorUserId: marker.consumingPrincipalId,
    triggerSource: post.triggerSource,
    content: post.content,
    mediaUrls: post.mediaUrls,
    stableMediaRefs: post.stableMediaRefs,
    platformSettings: post.platformSettings,
    scheduledAt: post.scheduledAt,
  });
  if (!valid) throw new FatalError("Governed Publishing Approval is missing, stale, or does not match this exact Plan Revision target.");
}

async function loadPost(
  postId: string,
  workspaceId: string,
): Promise<PostData> {
  "use step";

  const { getSocialPost, updatePostStatus } = await import(
    "@/lib/social/repository"
  );
  const { emitSocialEvent } = await import("@/lib/social/events");

  const post = await getSocialPost(workspaceId, postId);

  if (post.status === "published") {
    throw new FatalError("Social post was already published.");
  }
  if (
    post.status !== "draft" &&
    post.status !== "failed" &&
    post.status !== "queued" &&
    post.status !== "publishing"
  ) {
    throw new FatalError(`Social post is not publishable from "${post.status}".`);
  }

  const candidate: PostData = {
    id: post.id,
    workspaceId,
    content: post.content,
    mediaUrls: post.mediaUrls,
    stableMediaRefs: post.stableMediaRefs,
    platformSettings: post.platformSettings,
    socialAccountId: post.socialAccountId,
    scheduledAt: post.scheduledAt?.toISOString() ?? null,
    status: post.status,
    triggerSource: post.triggerSource,
    createdByUserId: post.createdByUserId,
  };
  await assertGovernedPublishingStep(candidate);

  // Transition to "publishing"
  await updatePostStatus(postId, "publishing");
  await emitSocialEvent({
    workspaceId,
    eventType: "post.publishing",
    severity: "info",
    message: "Social post moved to publishing state.",
    postId,
    accountId: post.socialAccountId,
  });

  return { ...candidate, status: "publishing" };
}

async function reloadPostBeforePublish(
  postId: string,
  workspaceId: string,
): Promise<PostData> {
  "use step";

  const { getSocialPost, updatePostStatus } = await import(
    "@/lib/social/repository"
  );
  const { emitSocialEvent } = await import("@/lib/social/events");

  const post = await getSocialPost(workspaceId, postId);

  if (post.status === "published") {
    throw new FatalError("Social post was already published.");
  }
  if (
    post.status !== "draft" &&
    post.status !== "failed" &&
    post.status !== "queued" &&
    post.status !== "publishing"
  ) {
    throw new FatalError(`Social post is not publishable from "${post.status}".`);
  }

  const candidate: PostData = {
    id: post.id,
    workspaceId,
    content: post.content,
    mediaUrls: post.mediaUrls,
    stableMediaRefs: post.stableMediaRefs,
    platformSettings: post.platformSettings,
    socialAccountId: post.socialAccountId,
    scheduledAt: post.scheduledAt?.toISOString() ?? null,
    status: post.status,
    triggerSource: post.triggerSource,
    createdByUserId: post.createdByUserId,
  };
  await assertGovernedPublishingStep(candidate);

  if (post.status !== "publishing") {
    await updatePostStatus(postId, "publishing");
    await emitSocialEvent({
      workspaceId,
      eventType: "post.publishing",
      severity: "info",
      message: "Social post moved to publishing state.",
      postId,
      accountId: post.socialAccountId,
    });
  }

  return { ...candidate, status: "publishing" };
}

interface AccountData {
  id: string;
  workspaceId: string;
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
  const { ensureSocialProvidersBootstrapped } = await import(
    "@/lib/social/runtime-bootstrap"
  );
  await ensureSocialProvidersBootstrapped();
  const { getProvider } = await import("@/lib/social/provider-registry");
  const { emitSocialEvent } = await import("@/lib/social/events");

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
      await emitSocialEvent({
        workspaceId: account.workspaceId,
        eventType: "token.refreshed",
        severity: "info",
        message: "Social access token refreshed successfully.",
        accountId: account.id,
        provider: account.platform as import("@/lib/db/schema").SocialPlatform,
      });

      return {
        id: account.id,
        workspaceId: account.workspaceId,
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
      await emitSocialEvent({
        workspaceId: account.workspaceId,
        eventType: "account.reauth_required",
        severity: "error",
        message: "Token refresh failed. Reconnection is required.",
        userFacing: true,
        accountId: account.id,
        provider: account.platform as import("@/lib/db/schema").SocialPlatform,
      });
      throw new FatalError(
        "Token refresh failed. Please reconnect your account.",
      );
    }
  }

  return {
    id: account.id,
    workspaceId: account.workspaceId,
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

async function validateProviderMedia(
  media: ProcessedMediaItem[],
  platform: string,
): Promise<ProcessedMediaItem[]> {
  if (media.length === 0) return [];
  const { validateMediaConstraints } = await import("@/lib/social/media");
  type SocialPlatform = import("@/lib/db/schema").SocialPlatform;

  const items = media.map((m) => ({
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

  return media;
}

interface PublishResultData {
  platformPostId: string;
  platformPostUrl: string;
  status: "published" | "processing";
}

async function publishStep(
  postId: string,
  content: string | null,
  account: AccountData,
  platformSettings: Record<string, unknown> | null,
): Promise<PublishResultData> {
  "use step";

  const { updatePostStatus, markRequiresReauth, claimSocialPostProviderEffect, resolveSocialPostMediaForDelivery } = await import(
    "@/lib/social/repository"
  );
  const { emitSocialEvent } = await import("@/lib/social/events");
  const { ensureSocialProvidersBootstrapped } = await import(
    "@/lib/social/runtime-bootstrap"
  );
  const { decryptToken } = await import("@/lib/social/crypto");

  let provider: import("@/lib/social/provider-interface").SocialProviderAdapter;
  try {
    await ensureSocialProvidersBootstrapped();
    const { getProvider } = await import("@/lib/social/provider-registry");
    provider = getProvider(account.platform);
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : `Social provider "${account.platform}" is not available.`;

    await updatePostStatus(postId, "failed", {
      errorMessage: message,
    });
    await emitSocialEvent({
      workspaceId: account.workspaceId,
      eventType: "post.failed",
      severity: "error",
      message,
      userFacing: true,
      postId,
      accountId: account.id,
      provider: account.platform as import("@/lib/db/schema").SocialPlatform,
    });
    throw new FatalError(message);
  }

  const accessToken = decryptToken(account.accessTokenEncrypted);
  const accessTokenSecret = account.accessTokenSecret
    ? decryptToken(account.accessTokenSecret)
    : undefined;

  const current = await claimSocialPostProviderEffect(account.workspaceId, postId);
  if (current.socialAccountId !== account.id) {
    throw new FatalError("Social account changed before the provider effect.");
  }
  const currentPost: PostData = {
    id: current.id,
    workspaceId: current.workspaceId,
    content: current.content,
    mediaUrls: current.mediaUrls,
    stableMediaRefs: current.stableMediaRefs,
    platformSettings: current.platformSettings,
    socialAccountId: current.socialAccountId,
    scheduledAt: current.scheduledAt?.toISOString() ?? null,
    status: current.status,
    triggerSource: current.triggerSource,
    createdByUserId: current.createdByUserId,
  };
  await verifyGovernedPublishing(currentPost);
  if (current.content !== content || JSON.stringify(current.platformSettings) !== JSON.stringify(platformSettings)) {
    throw new FatalError("The publishing target changed before the provider effect.");
  }
  const media = await validateProviderMedia(
    await resolveSocialPostMediaForDelivery(current.workspaceId, current.stableMediaRefs),
    account.platform,
  );

  try {
    const results = await provider.post(
      account.platformUserId,
      accessToken,
      [
        {
          postId,
          content: current.content || "",
          media: media.length > 0 ? media : undefined,
          platformSettings: current.platformSettings ?? undefined,
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
      status: result.status,
    };
  } catch (error) {
    // Classify the error to determine retry behavior
    const classified = provider.classifyError(error);

    if (classified.type === "bad-body") {
      // Non-recoverable — content is invalid
      await updatePostStatus(postId, "failed", {
        errorMessage: classified.message,
      });
      await emitSocialEvent({
        workspaceId: account.workspaceId,
        eventType: "post.failed",
        severity: "error",
        message: classified.message,
        userFacing: true,
        postId,
        accountId: account.id,
        provider: account.platform as import("@/lib/db/schema").SocialPlatform,
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
      await emitSocialEvent({
        workspaceId: account.workspaceId,
        eventType: "account.reauth_required",
        severity: "error",
        message: "Authentication expired. Reconnection is required.",
        userFacing: true,
        postId,
        accountId: account.id,
        provider: account.platform as import("@/lib/db/schema").SocialPlatform,
      });
      throw new FatalError("Token expired — requires re-authentication");
    }

    // "retry" — transient error, let WDK auto-retry (up to 3x)
    throw error;
  }
}

async function finalizeStep(
  post: Pick<PostData, "id" | "workspaceId" | "socialAccountId">,
  account: Pick<AccountData, "platform">,
  result: PublishResultData,
): Promise<void> {
  "use step";

  const { updatePostStatus } = await import("@/lib/social/repository");
  const { emitSocialEvent } = await import("@/lib/social/events");

  if (result.status === "processing") {
    await updatePostStatus(post.id, "publishing", {
      platformPostId: result.platformPostId,
      platformPostUrl: result.platformPostUrl,
      errorMessage: null,
    });
    await emitSocialEvent({
      workspaceId: post.workspaceId,
      eventType: "post.publishing",
      severity: "info",
      message: "Provider accepted the post and is still processing it.",
      postId: post.id,
      accountId: post.socialAccountId,
      provider: account.platform as import("@/lib/db/schema").SocialPlatform,
      metadata: {
        platformPostId: result.platformPostId,
        platformPostUrl: result.platformPostUrl,
      },
    });
    return;
  }

  await updatePostStatus(post.id, "published", {
    platformPostId: result.platformPostId,
    platformPostUrl: result.platformPostUrl,
    publishedAt: new Date(),
    errorMessage: null,
  });
  await emitSocialEvent({
    workspaceId: post.workspaceId,
    eventType: "post.published",
    severity: "info",
    message: "Social post published successfully.",
    postId: post.id,
    accountId: post.socialAccountId,
    provider: account.platform as import("@/lib/db/schema").SocialPlatform,
    metadata: {
      platformPostId: result.platformPostId,
      platformPostUrl: result.platformPostUrl,
    },
  });
}
