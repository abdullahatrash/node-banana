import { updatePostStatus } from "@/lib/social/repository";
import type { CopilotContext } from "./context";
import { validatePublishForDraft } from "./validate";

export interface CopilotCommitResult {
  postId: string;
  channelId: string;
  status: "queued";
  scheduledAt: string | null;
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
): Promise<CopilotCommitResult> {
  const readiness = await validatePublishForDraft(ctx, postId);
  if (!readiness.ready) {
    throw new Error(
      `Draft is not ready to publish: ${readiness.reasons.join("; ")}`,
    );
  }

  await updatePostStatus(postId, "queued", {
    scheduledAt: new Date(scheduledAtIso),
    dispatchStatus: "pending",
  });

  return {
    postId,
    channelId: readiness.channelId,
    status: "queued",
    scheduledAt: scheduledAtIso,
  };
}

/**
 * Publish a draft immediately. Same server-side gate as scheduleDraft, then
 * queues with no future schedule so the dispatcher picks it up at once. Gated
 * behind needsApproval at the tool layer.
 */
export async function publishNowForWorkspace(
  ctx: CopilotContext,
  postId: string,
): Promise<CopilotCommitResult> {
  const readiness = await validatePublishForDraft(ctx, postId);
  if (!readiness.ready) {
    throw new Error(
      `Draft is not ready to publish: ${readiness.reasons.join("; ")}`,
    );
  }

  await updatePostStatus(postId, "queued", {
    scheduledAt: null,
    dispatchStatus: "pending",
  });

  return {
    postId,
    channelId: readiness.channelId,
    status: "queued",
    scheduledAt: null,
  };
}
