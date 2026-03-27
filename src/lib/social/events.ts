import type { SocialEventSeverity, SocialEventType, SocialPlatform } from "@/lib/db/schema";
import { recordSocialEvent } from "@/lib/social/repository";
import { logger } from "@/utils/logger";

interface EmitSocialEventInput {
  workspaceId: string;
  eventType: SocialEventType;
  message: string;
  severity?: SocialEventSeverity;
  userFacing?: boolean;
  postId?: string;
  accountId?: string;
  provider?: SocialPlatform;
  dispatchKey?: string;
  workflowRunRef?: string;
  metadata?: Record<string, unknown>;
  createdByUserId?: string;
}

export async function emitSocialEvent(input: EmitSocialEventInput) {
  try {
    return await recordSocialEvent(input);
  } catch (error) {
    logger.warn("system", "Failed to persist social event", {
      workspaceId: input.workspaceId,
      eventType: input.eventType,
      postId: input.postId,
      accountId: input.accountId,
      provider: input.provider,
      dispatchKey: input.dispatchKey,
      workflowRunRef: input.workflowRunRef,
      eventError: error instanceof Error ? error.message : "unknown",
    });
    return null;
  }
}
