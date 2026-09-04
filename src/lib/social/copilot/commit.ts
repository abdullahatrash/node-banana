import { canonicalDigest } from "@/lib/agent-tools/canonical";
import {
  governedPublishingMarker,
  parseGovernedPublishingMarker,
  PRODUCTION_SOCIAL_PUBLISHING_APPROVAL_ADMISSION,
  type SocialPublishingApprovalEvidence,
} from "@/lib/agent-tools/social-publishing-approval";
import { getSocialPost, updateSocialPost, updatePostStatus } from "@/lib/social/repository";
import type { CopilotContext } from "./context";
import { validatePublishForDraft } from "./validate";

export interface CopilotCommitResult {
  postId: string;
  channelId: string;
  status: "queued";
  scheduledAt: string | null;
}

export interface CopilotPublishingCommitInput {
  publishingApproval: SocialPublishingApprovalEvidence;
  idempotencyKey: string;
}

async function queueApprovedDraft(input: {
  ctx: CopilotContext;
  postId: string;
  requestedPublishAt?: string;
  requireImmediate: boolean;
  approval: CopilotPublishingCommitInput;
}): Promise<CopilotCommitResult> {
  const post = await getSocialPost(input.ctx.workspaceId, input.postId);
  const marker = parseGovernedPublishingMarker(post.triggerSource);
  if (post.status === "queued" && marker?.idempotencyKey === input.approval.idempotencyKey) {
    const valid = await PRODUCTION_SOCIAL_PUBLISHING_APPROVAL_ADMISSION.verifyConsumed({
      workspaceId: input.ctx.workspaceId,
      socialAccountId: post.socialAccountId,
      actorUserId: input.ctx.userId,
      triggerSource: post.triggerSource,
      content: post.content,
      mediaUrls: post.mediaUrls,
      stableMediaRefs: post.stableMediaRefs,
      platformSettings: post.platformSettings,
      scheduledAt: post.scheduledAt,
    });
    if (valid) return {
      postId: post.id,
      channelId: post.socialAccountId,
      status: "queued",
      scheduledAt: post.scheduledAt?.toISOString() ?? null,
    };
  }
  if (post.status !== "draft") throw new Error("Only a draft or an idempotent approved queue replay can be committed.");
  if (input.approval.publishingApproval.consumingPrincipalId !== input.ctx.userId) {
    throw new Error("Publishing Approval release authorization belongs to a different actor.");
  }
  const inspected = await PRODUCTION_SOCIAL_PUBLISHING_APPROVAL_ADMISSION.inspect({
    workspaceId: input.ctx.workspaceId,
    socialAccountId: post.socialAccountId,
    evidence: input.approval.publishingApproval,
  });
  if (!inspected) throw new Error("Publishing Approval is unavailable, stale, consumed, or not exact for this Channel.");
  const target = inspected.target;
  if (input.requireImmediate && target.timing.kind !== "now") {
    throw new Error("This approved Plan target is scheduled; it cannot be published immediately.");
  }
  if (input.requestedPublishAt && input.requestedPublishAt !== target.timing.publishAt) {
    throw new Error("The requested schedule does not match the approved Plan Revision target.");
  }
  const postMedia = (post.mediaUrls ?? []).map((media) => ({ type: media.type, url: media.url }));
  const targetMedia = target.media.map((media) => ({ type: "image", url: media.previewUrl }));
  if (
    post.content?.trim() !== target.content.text ||
    canonicalDigest(post.platformSettings ?? {}) !== canonicalDigest(target.settings) ||
    canonicalDigest(postMedia) !== canonicalDigest(targetMedia)
  ) throw new Error("The draft no longer matches the exact approved Plan Revision target.");
  const consumption = await PRODUCTION_SOCIAL_PUBLISHING_APPROVAL_ADMISSION.consume({
    workspaceId: input.ctx.workspaceId,
    inspected,
  });
  if (consumption !== "consumed") throw new Error("Publishing Approval release authorization could not be consumed.");
  const publishAt = new Date(target.timing.publishAt);
  await updateSocialPost(input.ctx.workspaceId, input.postId, {
    triggerSource: governedPublishingMarker({
      schema: "governed-social-publishing/v1",
      approvalRequestId: inspected.requestId,
      targetId: target.targetId,
      targetEvidenceDigest: target.targetEvidenceDigest,
      consumingPrincipalId: input.ctx.userId,
      idempotencyKey: input.approval.idempotencyKey,
    }),
  });
  await updatePostStatus(input.postId, "queued", {
    scheduledAt: publishAt,
    dispatchStatus: "pending",
  });
  return { postId: input.postId, channelId: post.socialAccountId, status: "queued", scheduledAt: publishAt.toISOString() };
}

/**
 * Schedule a draft for publishing. Re-runs Publish Validation server-side and
 * refuses to queue an unready draft (ADR 0002). On success, transitions the
 * post to `queued` with the schedule; the dispatcher claims it and starts the
 * publish workflow. Gated behind needsApproval at the tool layer.
 */
export async function scheduleDraftForWorkspace(
  ctx: CopilotContext,
  postId: string,
  scheduledAtIso: string,
  approval: CopilotPublishingCommitInput,
): Promise<CopilotCommitResult> {
  const readiness = await validatePublishForDraft(ctx, postId);
  if (!readiness.ready) {
    throw new Error(
      `Draft is not ready to publish: ${readiness.reasons.join("; ")}`,
    );
  }

  return queueApprovedDraft({ ctx, postId, requestedPublishAt: scheduledAtIso, requireImmediate: false, approval });
}

/**
 * Publish a draft immediately. Same server-side gate as scheduleDraft, then
 * queues with no future schedule so the dispatcher picks it up at once. Gated
 * behind needsApproval at the tool layer.
 */
export async function publishNowForWorkspace(
  ctx: CopilotContext,
  postId: string,
  approval: CopilotPublishingCommitInput,
): Promise<CopilotCommitResult> {
  const readiness = await validatePublishForDraft(ctx, postId);
  if (!readiness.ready) {
    throw new Error(
      `Draft is not ready to publish: ${readiness.reasons.join("; ")}`,
    );
  }

  return queueApprovedDraft({ ctx, postId, requireImmediate: true, approval });
}
