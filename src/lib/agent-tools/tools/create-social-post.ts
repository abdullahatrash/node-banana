import { z } from "zod";
import { canonicalDigest } from "../canonical";

import type { SocialPlatform } from "@/lib/db/schema";
import { emitSocialEvent } from "@/lib/social/events";
import { getSocialPlanLimits } from "@/lib/social/limits";
import { validateSelectedPublishingSettings } from "@/lib/social/publishing-settings";
import {
  countSocialPostsCreatedInRange,
  createSocialPost,
  getSocialAccount,
  SocialAccountNotFoundError,
  updatePostStatus,
} from "@/lib/social/repository";
import { buildCdnDownloadUrl, createPresignedDownload } from "@/lib/storage";
import { getAsset } from "@/lib/studio/repository";

import { ToolError } from "../errors";
import type { ToolContext, ToolDefinition } from "../types";
import {
  exactApprovedSocialPostInput,
  governedPublishingMarker,
  PRODUCTION_SOCIAL_PUBLISHING_APPROVAL_ADMISSION,
} from "../social-publishing-approval";

const inputSchema = z.object({
  /** The connected social account (channel) to post to; must belong to the workspace. */
  socialAccountId: z.string(),
  /** Post text. Optional only when at least one media asset is attached. */
  content: z.string().optional(),
  /** Workspace asset ids (image/video) resolved server-side to media URLs. */
  mediaAssetIds: z.array(z.string()).optional(),
  /** Per-platform publishing overrides, forwarded to the existing pipeline. */
  platformSettings: z.record(z.string(), z.unknown()).optional(),
  /** Create as a draft only (not queued for dispatch). Mutually exclusive with scheduledAt. */
  draft: z.boolean().optional(),
  /** ISO timestamp to publish at. Omit (with draft omitted) to publish now. */
  scheduledAt: z.string().optional(),
  /** Exact approved Plan Revision target plus fresh release authorization. */
  publishingApproval: z.object({
    approvalRequestId: z.string().min(1).max(200),
    targetId: z.string().min(1).max(200),
    targetEvidenceDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    consumingPrincipalId: z.string().min(1).max(200),
    consumingKeyId: z.string().min(1).max(200),
    authorizationEvidenceRef: z.string().min(1).max(500),
    authorizationIssuedAt: z.string().datetime({ offset: true }),
    authorizationExpiresAt: z.string().datetime({ offset: true }),
  }).strict().optional(),
});

const outputSchema = z.object({
  postId: z.string(),
  status: z.string(),
  scheduledAt: z.string().nullable(),
});

/** Mirrors the studio download route's readiness check (see get_asset_download_url). */
function isAssetReady(metadata: unknown): boolean {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return true;
  }
  const uploadState = (metadata as Record<string, unknown>).uploadState;
  return uploadState !== "failed" && uploadState !== "pending";
}

type ResolvedMedia = { type: "image" | "video"; url: string };

/**
 * Resolve a workspace asset id to a post media item, reusing the same download
 * resolution the get_asset_download_url tool uses (CDN url, else a presigned
 * S3/R2 url). Only image and video assets can be attached to a social post.
 */
async function resolveAssetMedia(
  workspaceId: string,
  assetId: string,
): Promise<ResolvedMedia> {
  const asset = await getAsset(workspaceId, assetId);
  if (!asset) {
    throw new ToolError({
      code: "not_found",
      message: `Asset not found: ${assetId}.`,
      fix: "Check the asset id, or call list_assets to find a valid one.",
    });
  }

  if (asset.type !== "image" && asset.type !== "video") {
    throw new ToolError({
      code: "invalid_input",
      message: `Asset ${assetId} is a ${asset.type}; only image and video assets can be attached to a post.`,
      fix: "Attach an image or video asset, or omit it.",
    });
  }

  if (asset.storageProvider !== "s3") {
    throw new ToolError({
      code: "invalid_input",
      message: `Asset ${assetId} is not stored in S3/R2 and has no shareable URL.`,
      fix: "Attach an asset uploaded to cloud storage.",
    });
  }

  if (!asset.storageKey?.trim()) {
    throw new ToolError({
      code: "invalid_input",
      message: `Asset ${assetId} has no storage key.`,
      fix: "This asset record is incomplete and cannot be attached.",
    });
  }

  if (!isAssetReady(asset.metadata)) {
    throw new ToolError({
      code: "invalid_input",
      message: `Asset ${assetId} upload is not ready.`,
      fix: "Wait for the upload to finish, or re-upload if it failed.",
    });
  }

  const cdnUrl = buildCdnDownloadUrl({ key: asset.storageKey });
  const url = cdnUrl ?? (await createPresignedDownload({ key: asset.storageKey })).downloadUrl;
  return { type: asset.type, url };
}

async function enforceMonthlyQuota(ctx: ToolContext): Promise<void> {
  const limits = getSocialPlanLimits(ctx.session.planTier);
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const monthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const monthlyPosts = await countSocialPostsCreatedInRange(
    ctx.session.workspace.id,
    monthStart,
    monthEnd,
  );
  if (monthlyPosts >= limits.postsPerMonth) {
    throw new ToolError({
      code: "forbidden",
      message: `Monthly post limit reached (${monthlyPosts}/${limits.postsPerMonth}).`,
      fix: "Wait until next month, or upgrade the workspace plan for a higher limit.",
    });
  }
}

/**
 * Create a social post through the exact pipeline the app uses: a row via
 * `createSocialPost` (indistinguishable from an app-composed post), optionally
 * transitioned to `queued` in the precise state the committed dispatch cron
 * consumes (`listDueQueuedPosts`), so it publishes through the same durable
 * workflow. `draft` leaves it unqueued; `scheduledAt` queues it for a time;
 * omitting both publishes now.
 */
export const createSocialPostTool: ToolDefinition<
  typeof inputSchema,
  typeof outputSchema
> = {
  name: "create_social_post",
  description:
    "Create a social post (text + media asset ids) on a connected account as a draft, scheduled for an ISO time, or published now. Queued posts land in the same dispatch pipeline as app-composed posts. Returns { postId, status, scheduledAt }.",
  requiredPermission: "social:publish",
  inputSchema,
  outputSchema,
  handler: async (input, ctx) => {
    const workspaceId = ctx.session.workspace.id;
    const isDraft = input.draft === true;

    if (isDraft && input.scheduledAt) {
      throw new ToolError({
        code: "invalid_input",
        message: "Provide either draft or scheduledAt, not both.",
        fix: "Set draft:true for a draft, or pass scheduledAt to schedule; omit both to publish now.",
      });
    }

    let scheduledDate: Date | null = null;
    if (!isDraft) {
      if (input.scheduledAt) {
        const parsed = new Date(input.scheduledAt);
        if (Number.isNaN(parsed.getTime())) {
          throw new ToolError({
            code: "invalid_input",
            message: `scheduledAt is not a valid ISO timestamp: ${input.scheduledAt}.`,
            fix: "Pass an ISO 8601 timestamp, e.g. 2026-07-10T15:00:00.000Z.",
          });
        }
        scheduledDate = parsed;
      } else {
        scheduledDate = new Date();
      }
    }

    const content = input.content?.trim() || undefined;
    const assetIds = input.mediaAssetIds ?? [];
    if (!content && assetIds.length === 0) {
      throw new ToolError({
        code: "invalid_input",
        message: "A post needs content or at least one media asset.",
        fix: "Provide content, mediaAssetIds, or both.",
      });
    }

    // Account ownership: getSocialAccount is workspace-scoped, so an account
    // from another tenant is indistinguishable from a missing one.
    let account;
    try {
      account = await getSocialAccount(workspaceId, input.socialAccountId);
    } catch (error) {
      if (error instanceof SocialAccountNotFoundError) {
        throw new ToolError({
          code: "not_found",
          message: "Social account not found in this workspace.",
          fix: "Call list_social_accounts and use one of the returned account ids.",
        });
      }
      throw error;
    }

    if (!isDraft) {
      if (!input.publishingApproval) {
        throw new ToolError({
          code: "forbidden",
          message: "Publishing requires an accepted exact Plan Revision Approval.",
          fix: "Request and approve the exact publishing plan target, then pass its publishingApproval evidence.",
        });
      }
      if (account.disabled) {
        throw new ToolError({
          code: "forbidden",
          message: "This social account is disabled and cannot publish.",
          fix: "Re-enable or reconnect the account, or create the post as a draft.",
        });
      }
      if (account.requiresReauth) {
        throw new ToolError({
          code: "forbidden",
          message: "This social account needs to be reconnected before publishing.",
          fix: "Reconnect the account in the app, or create the post as a draft.",
        });
      }
    }

    const inspectedApproval = isDraft ? null : await PRODUCTION_SOCIAL_PUBLISHING_APPROVAL_ADMISSION.inspect({
      workspaceId,
      socialAccountId: input.socialAccountId,
      evidence: input.publishingApproval!,
    });
    if (!isDraft && (!inspectedApproval || !exactApprovedSocialPostInput(input, inspectedApproval.target))) {
      throw new ToolError({
        code: "forbidden",
        message: "Publishing Approval is unavailable, consumed, stale, or does not match this exact post target.",
        fix: "Inspect the current approved target and submit the exact approved content, settings, channel, and timing.",
      });
    }
    if (inspectedApproval) {
      scheduledDate = new Date(inspectedApproval.target.timing.publishAt);
    }

    await enforceMonthlyQuota(ctx);

    const mediaUrls: ResolvedMedia[] = [];
    for (const assetId of assetIds) {
      mediaUrls.push(await resolveAssetMedia(workspaceId, assetId));
    }

    // Platform constraints (length, media counts, etc.) are validated only when
    // the post will actually publish — drafts can be incomplete, exactly as in
    // the app composer.
    if (!isDraft) {
      const validation = validateSelectedPublishingSettings({
        selectedChannelIds: [input.socialAccountId],
        settingsByChannelId: {
          [input.socialAccountId]: input.platformSettings ?? {},
        },
        platformByChannelId: {
          [input.socialAccountId]: account.platform as SocialPlatform,
        },
        labelByChannelId: {
          [input.socialAccountId]: account.displayName ?? account.platform,
        },
        content: content ?? "",
        media: mediaUrls,
      });
      if (!validation.valid) {
        throw new ToolError({
          code: "invalid_input",
          message: validation.errors[0] ?? "Post fails the platform's publishing constraints.",
          fix: "Adjust the content, media, or platform settings to satisfy the platform's limits.",
        });
      }
    }

    const approvedTarget = inspectedApproval?.target;
    const post = await createSocialPost({
      workspaceId,
      socialAccountId: input.socialAccountId,
      content: approvedTarget?.content.text ?? content,
      mediaUrls: approvedTarget
        ? approvedTarget.media.map((item) => ({ type: "image", url: item.previewUrl }))
        : mediaUrls.length > 0 ? mediaUrls : undefined,
      platformSettings: approvedTarget?.settings ?? input.platformSettings,
      studioAssetId: assetIds[0],
      triggerSource: inspectedApproval ? governedPublishingMarker({
        schema: "governed-social-publishing/v1",
        approvalRequestId: inspectedApproval.requestId,
        targetId: inspectedApproval.target.targetId,
        targetEvidenceDigest: inspectedApproval.target.targetEvidenceDigest,
        consumingPrincipalId: inspectedApproval.evidence.consumingPrincipalId,
        idempotencyKey: canonicalDigest({
          actor: inspectedApproval.evidence.consumingPrincipalId,
          authorizationEvidenceRef: inspectedApproval.evidence.authorizationEvidenceRef,
          approvalRequestId: inspectedApproval.requestId,
          targetId: inspectedApproval.target.targetId,
        }),
      }) : undefined,
      createdByUserId: ctx.session.user.id,
    });

    if (isDraft || !scheduledDate) {
      return { postId: post.id, status: post.status, scheduledAt: null };
    }

    const consumption = await PRODUCTION_SOCIAL_PUBLISHING_APPROVAL_ADMISSION.consume({
      workspaceId,
      inspected: inspectedApproval!,
    });
    if (consumption !== "consumed") {
      throw new ToolError({
        code: "forbidden",
        message: "Publishing Approval could not be consumed with current exact release authorization.",
        fix: "Refresh the release authorization and request a new Approval if this decision was already consumed.",
      });
    }

    // Transition into the queued state the dispatch cron picks up: status
    // "queued" + dispatchStatus "pending" + a due scheduledAt, with no
    // workflowRunRef yet. This is the identical shape an app draft reaches when
    // published, so the same durable publish workflow carries it to release.
    const queued = await updatePostStatus(post.id, "queued", {
      scheduledAt: scheduledDate,
      dispatchStatus: "pending",
      workflowRunRef: null,
      nextDispatchAt: null,
      lastDispatchError: null,
      errorMessage: null,
      lockedAt: null,
    });

    await emitSocialEvent({
      workspaceId,
      eventType: "post.queued",
      severity: "info",
      message: "Social post queued for publishing.",
      postId: post.id,
      accountId: input.socialAccountId,
      provider: account.platform as SocialPlatform,
      metadata: {
        scheduledAt: scheduledDate.toISOString(),
        source: "agent-api",
      },
      createdByUserId: ctx.session.user.id,
    });

    return {
      postId: queued.id,
      status: queued.status,
      scheduledAt: queued.scheduledAt ? new Date(queued.scheduledAt).toISOString() : null,
    };
  },
};
