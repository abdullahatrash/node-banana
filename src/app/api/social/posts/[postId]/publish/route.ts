import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { isDatabaseConfigured } from "@/lib/db";
import { withApiPermission } from "@/lib/studio/authz";
import {
  claimSocialDispatchRun,
  finalizeSocialDispatchRun,
  getSocialAccountById,
  getSocialPost,
  hasChainChildren,
  updatePostStatus,
  updateSocialPost,
  SocialPostNotFoundError,
  SocialPostStateTransitionError,
} from "@/lib/social/repository";
import type { SocialPlatform } from "@/lib/db/schema";
import type { PublishMediaItem } from "@/lib/social/provider-interface";
import { validateSelectedPublishingSettings } from "@/lib/social/publishing-settings";
import { resolveWorkflowRunRef } from "@/lib/social/workflow-utils";
import { emitSocialEvent } from "@/lib/social/events";
import { isRecord } from "@/lib/social/utils";
import { start } from "workflow/api";
import {
  publishPostChainWorkflow,
  publishPostWorkflow,
} from "@/../workflows/social-publish";
import { logger } from "@/utils/logger";
import { requiresGovernedPublishingPlan } from "@/lib/governance/publishing-route-guard";
import { canonicalDigest } from "@/lib/agent-tools/canonical";
import {
  governedPublishingMarker,
  PRODUCTION_SOCIAL_PUBLISHING_APPROVAL_ADMISSION,
  socialPublishingApprovalEvidenceSchema,
  type InspectedSocialPublishingApproval,
} from "@/lib/agent-tools/social-publishing-approval";

interface PublishResponse {
  success: boolean;
  post?: Record<string, unknown>;
  error?: string;
}

const PUBLISHABLE_STATES = new Set(["draft", "failed"]);
const FORCE_NOW_STATES = new Set(["queued", "publishing"]);
const DISPATCH_RETRY_DELAY_MS = 5 * 60 * 1000;

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

async function readOptionalJsonBody(
  request: NextRequest,
): Promise<Record<string, unknown>> {
  const contentLength = request.headers.get("content-length");
  if (contentLength === "0") {
    return {};
  }

  const text = await request.clone().text();
  if (!text.trim()) {
    return {};
  }

  try {
    const parsed = JSON.parse(text);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function extractWorkflowContext(
  body: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const context: Record<string, unknown> = {};

  const chain = isRecord(body.chain) ? body.chain : undefined;
  const automation = isRecord(body.automation) ? body.automation : undefined;

  const chainId = readString(body.chainId);
  const automationId = readString(body.automationId);
  const chainRunId = readString(body.chainRunId);
  const automationRunId = readString(body.automationRunId);

  if (chainId) context.chainId = chainId;
  if (automationId) context.automationId = automationId;
  if (chainRunId) context.chainRunId = chainRunId;
  if (automationRunId) context.automationRunId = automationRunId;
  if (chain) context.chain = chain;
  if (automation) context.automation = automation;

  return Object.keys(context).length > 0 ? context : undefined;
}

function toPublishMediaItems(
  mediaUrls: Array<{ type: string; url: string; alt?: string }> | null | undefined,
): PublishMediaItem[] {
  if (!Array.isArray(mediaUrls)) return [];

  return mediaUrls.flatMap((item) => {
    if (
      (item.type !== "image" && item.type !== "video") ||
      typeof item.url !== "string" ||
      !item.url.trim()
    ) {
      return [];
    }

    return [
      {
        type: item.type,
        url: item.url,
        ...(item.alt ? { alt: item.alt } : {}),
      },
    ];
  });
}

function hasCompleteStableMediaBinding(post: {
  mediaUrls: Array<{ type: string; url: string; alt?: string }> | null | undefined;
  stableMediaRefs?: Array<{ resourceKind?: "studio_asset" | "artifact"; assetId: string; assetDigest: string; order: number }> | null;
}): boolean {
  const media = post.mediaUrls ?? [];
  const references = post.stableMediaRefs ?? [];
  if (media.length !== references.length) return false;
  const identities = new Set<string>();
  return references.every((reference, index) => {
    const identity = `${reference.resourceKind ?? "studio_asset"}:${reference.assetId}`;
    if (
      reference.order !== index ||
      !/^sha256:[a-f0-9]{64}$/.test(reference.assetDigest) ||
      identities.has(identity)
    ) return false;
    identities.add(identity);
    return true;
  });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ postId: string }> },
): Promise<NextResponse<PublishResponse>> {
  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      { success: false, error: "DATABASE_URL is not configured." },
      { status: 503 },
    );
  }

  try {
    const result = await withApiPermission(request, {
      route: "/api/social/posts",
      permission: "social:publish",
    });

    if (!result.authorized) {
      return result.response;
    }

    const { postId } = await params;
    const workspaceId = result.session.workspace.id;
    const body = await readOptionalJsonBody(request);
    const workflowContext = extractWorkflowContext(body);
    const post = await getSocialPost(workspaceId, postId);
    if (!hasCompleteStableMediaBinding(post)) {
      return NextResponse.json(
        { success: false, error: "Every published media item must have one ordered Workspace-owned SHA-256 reference." },
        { status: 409 },
      );
    }
    const forceNow = body.forceNow === true;
    const now = new Date();
    const isFuturePublishing =
      post.status === "publishing" &&
      post.scheduledAt !== null &&
      post.scheduledAt !== undefined &&
      post.scheduledAt.getTime() > now.getTime();
    const canForceNow =
      forceNow &&
      (post.status === "queued" || isFuturePublishing);

    let governedTriggerSource: string | undefined;
    let governedPublishAt: Date | undefined;
    let inspectedGoverned: InspectedSocialPublishingApproval | null = null;
    if (await requiresGovernedPublishingPlan(workspaceId)) {
      const approvalResult = socialPublishingApprovalEvidenceSchema.safeParse(body.publishingApproval);
      const idempotencyKey = readString(body.idempotencyKey);
      if (!approvalResult.success || !idempotencyKey || approvalResult.data.consumingPrincipalId !== result.session.user.id) {
        return NextResponse.json(
          { success: false, error: "This Workspace requires exact Publishing Approval evidence, actor-bound release authorization, and a stable idempotencyKey." },
          { status: 409 },
        );
      }
      const inspected = await PRODUCTION_SOCIAL_PUBLISHING_APPROVAL_ADMISSION.inspect({
        workspaceId,
        socialAccountId: post.socialAccountId,
        evidence: approvalResult.data,
      });
      const postMedia = (post.mediaUrls ?? []).map((media) => ({ type: media.type, url: media.url }));
      const targetMedia = inspected?.target.media.map((media) => ({ type: "image", url: media.previewUrl })) ?? [];
      const postStableMedia = (post.stableMediaRefs ?? []).map((reference) => ({ resourceKind: reference.resourceKind ?? "studio_asset", assetId: reference.assetId, assetDigest: reference.assetDigest, order: reference.order }));
      const targetStableMedia = inspected?.target.media.map((media, order) => ({ resourceKind: "artifact", assetId: media.artifactId, assetDigest: media.digest, order })) ?? [];
      if (
        !inspected || post.content?.trim() !== inspected.target.content.text ||
        canonicalDigest(post.platformSettings ?? {}) !== canonicalDigest(inspected.target.settings) ||
        canonicalDigest(postStableMedia) !== canonicalDigest(targetStableMedia) ||
        canonicalDigest(postMedia) !== canonicalDigest(targetMedia) ||
        (forceNow && inspected.target.timing.kind !== "now")
      ) return NextResponse.json(
        { success: false, error: "The current post does not match the exact approved Plan Revision target." },
        { status: 409 },
      );
      inspectedGoverned = inspected;
      governedPublishAt = new Date(inspected.target.timing.publishAt);
      governedTriggerSource = governedPublishingMarker({
        schema: "governed-social-publishing/v1",
        approvalRequestId: inspected.requestId,
        targetId: inspected.target.targetId,
        targetEvidenceDigest: inspected.target.targetEvidenceDigest,
        consumingPrincipalId: result.session.user.id,
        idempotencyKey,
      });
    }

    if (!PUBLISHABLE_STATES.has(post.status) && !canForceNow) {
      return NextResponse.json(
        {
          success: false,
          error: forceNow && FORCE_NOW_STATES.has(post.status)
            ? `Cannot publish a post with status "${post.status}" immediately unless it is scheduled for the future.`
            : `Cannot publish a post with status "${post.status}". Only draft and failed posts can be published.`,
        },
        { status: 400 },
      );
    }

    const account = await getSocialAccountById(post.socialAccountId);
    const publishingSettingsValidation = validateSelectedPublishingSettings({
      selectedChannelIds: [post.socialAccountId],
      settingsByChannelId: {
        [post.socialAccountId]: post.platformSettings ?? {},
      },
      platformByChannelId: {
        [post.socialAccountId]: account.platform as SocialPlatform,
      },
      labelByChannelId: {
        [post.socialAccountId]: account.displayName ?? account.platform,
      },
      content: post.content ?? "",
      media: toPublishMediaItems(post.mediaUrls),
    });

    if (!publishingSettingsValidation.valid) {
      return NextResponse.json(
        {
          success: false,
          error: publishingSettingsValidation.errors[0],
        },
        { status: 400 },
      );
    }

    if (inspectedGoverned) {
      const consumption = await PRODUCTION_SOCIAL_PUBLISHING_APPROVAL_ADMISSION.consume({ workspaceId, inspected: inspectedGoverned });
      if (consumption !== "consumed") return NextResponse.json(
        { success: false, error: "Publishing Approval release authorization is stale or already consumed." },
        { status: 409 },
      );
    }

    const dispatchAttempts = (post.dispatchAttempts ?? 0) + 1;
    const dispatchKey = `publish:${result.session.user.id}:${postId}:${dispatchAttempts}`;
    const dispatchClaimToken = randomUUID();
    const eventMetadata = {
      previousStatus: post.status,
      scheduledAt: post.scheduledAt?.toISOString() ?? null,
      forceNow,
      ...(workflowContext ? { workflowContext } : {}),
    };

    // Transition to "queued" and persist dispatch intent metadata first.
    if (governedTriggerSource) {
      await updateSocialPost(workspaceId, postId, { triggerSource: governedTriggerSource });
    }
    await updatePostStatus(postId, "queued", {
      ...(governedPublishAt ? { scheduledAt: governedPublishAt } : forceNow ? { scheduledAt: now } : {}),
      errorMessage: null,
      retryCount: post.status === "failed" ? 0 : undefined,
      dispatchStatus: "pending",
      dispatchAttempts,
      workflowRunRef: null,
      nextDispatchAt: forceNow ? now : null,
      lastDispatchError: null,
      lockedAt: now,
    });
    await emitSocialEvent({
      workspaceId,
      eventType: "post.queued",
      severity: "info",
      message: forceNow
        ? "Social post queued for immediate publishing."
        : "Social post queued for publishing.",
      postId,
      accountId: post.socialAccountId,
      dispatchKey,
      metadata: eventMetadata,
      createdByUserId: result.session.user.id,
    });
    logger.info("system", "Social post queued for publish", {
      workspaceId,
      postId,
      accountId: post.socialAccountId,
      dispatchKey,
      workflowRunRef: null,
    });

    const dispatchRun = await claimSocialDispatchRun({
      workspaceId,
      dispatchKey,
      claimToken: dispatchClaimToken,
      kind: "post",
      postId,
      accountId: post.socialAccountId,
      payload: {
        postId,
        workspaceId,
      },
      metadata: {
        source: "publish-route",
      },
    });

    if (!dispatchRun || dispatchRun.claimToken !== dispatchClaimToken) {
      const duplicate = await updatePostStatus(postId, "queued", {
        dispatchStatus: "dispatched",
        lockedAt: null,
      });
      return NextResponse.json(
        {
          success: false,
          post: duplicate,
          error: "Dispatch already claimed by another run.",
        },
        { status: 409 },
      );
    }

    // Start the durable publish workflow — returns immediately
    // Workflow handles sleep (scheduled), token refresh, media processing, and publish
    try {
      const isChainRoot =
        post.rootPostId === null &&
        ((post.kind ?? "post") === "chain_root" ||
          (await hasChainChildren(workspaceId, postId)));
      const workflowRun = isChainRoot
        ? await start(publishPostChainWorkflow, [
            postId,
            result.session.workspace.id,
          ])
        : await start(publishPostWorkflow, [
            postId,
            result.session.workspace.id,
          ]);
      const workflowRunRef = resolveWorkflowRunRef(workflowRun, dispatchKey);
      const updated = await updatePostStatus(postId, "queued", {
        dispatchStatus: "dispatched",
        workflowRunRef,
        lockedAt: null,
      });
      await finalizeSocialDispatchRun({
        dispatchKey,
        state: "succeeded",
        result: { workflowRunRef },
      });
      logger.info("system", "Social publish workflow dispatched", {
        workspaceId,
        postId,
        accountId: post.socialAccountId,
        dispatchKey,
        workflowRunRef,
        chainWorkflow: isChainRoot,
      });
      return NextResponse.json({ success: true, post: updated });
    } catch (workflowError) {
      const retryAt = new Date(Date.now() + DISPATCH_RETRY_DELAY_MS);
      const workflowMessage =
        workflowError instanceof Error
          ? workflowError.message
          : "Unknown workflow dispatch error";
      await finalizeSocialDispatchRun({
        dispatchKey,
        state: "failed",
        errorMessage: workflowMessage,
      });
      const updated = await updatePostStatus(postId, "queued", {
        errorMessage: "Dispatch failed. Automatic retry has been scheduled.",
        dispatchStatus: "retry_scheduled",
        nextDispatchAt: retryAt,
        lastDispatchError: workflowMessage,
        workflowRunRef: null,
        lockedAt: null,
      });
      await emitSocialEvent({
        workspaceId,
        eventType: "dispatch.failed",
        severity: "warn",
        message: "Dispatch failed and retry was scheduled.",
        postId,
        accountId: post.socialAccountId,
        dispatchKey,
        metadata: {
          error: workflowMessage,
          retryAt: retryAt.toISOString(),
          ...(workflowContext ? { workflowContext } : {}),
        },
      });
      logger.warn("system", "Social publish dispatch failed", {
        workspaceId,
        postId,
        accountId: post.socialAccountId,
        dispatchKey,
        workflowRunRef: null,
        error: workflowMessage,
      });
      return NextResponse.json(
        {
          success: false,
          post: updated,
          error: "Failed to dispatch workflow. Automatic retry has been scheduled.",
        },
        { status: 503 },
      );
    }
  } catch (error) {
    if (error instanceof SocialPostNotFoundError) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 404 },
      );
    }
    if (error instanceof SocialPostStateTransitionError) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 400 },
      );
    }
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to publish post",
      },
      { status: 500 },
    );
  }
}
