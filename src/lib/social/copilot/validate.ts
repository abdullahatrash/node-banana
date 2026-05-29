import type { SocialPlatform } from "@/lib/db/schema";
import { getSocialPost, getSocialAccount } from "@/lib/social/repository";
import { getProvider } from "@/lib/social/provider-registry";
import { validateSelectedPublishingSettings } from "@/lib/social/publishing-settings";
import type { PublishMediaItem } from "@/lib/social/provider-interface";
import type { CopilotContext } from "./context";

export interface CopilotReadiness {
  postId: string;
  channelId: string;
  platform: string;
  ready: boolean;
  reasons: string[];
}

type DraftRow = {
  socialAccountId: string;
  content: string | null;
  mediaUrls: Array<{ type: string; url: string; alt?: string }> | null;
  platformSettings: Record<string, unknown> | null;
};

/**
 * Run Publish Validation for a draft and report per-Channel Publishing
 * Readiness (a draft maps to one Channel). Backs the `validatePublish` tool.
 */
export async function validatePublishForDraft(
  ctx: CopilotContext,
  postId: string,
): Promise<CopilotReadiness> {
  const post = (await getSocialPost(ctx.workspaceId, postId)) as DraftRow;
  const account = (await getSocialAccount(ctx.workspaceId, post.socialAccountId)) as {
    platform: SocialPlatform;
  };
  const platform = account.platform;
  const caps = getProvider(platform).getCapabilities();

  const content = post.content ?? "";
  const media = post.mediaUrls ?? [];
  const reasons: string[] = [];

  if (!content && media.length === 0) {
    reasons.push("Post has no content or media.");
  }
  if (content.length > caps.maxContentLength) {
    reasons.push(
      `Content is ${content.length} characters; ${caps.displayName} allows ${caps.maxContentLength}.`,
    );
  }

  const settingsResult = validateSelectedPublishingSettings({
    selectedChannelIds: [post.socialAccountId],
    settingsByChannelId: { [post.socialAccountId]: post.platformSettings ?? {} },
    platformByChannelId: { [post.socialAccountId]: platform },
    content,
    media: media as PublishMediaItem[],
  });
  if (!settingsResult.valid) {
    reasons.push(...settingsResult.errors);
  }

  return {
    postId,
    channelId: post.socialAccountId,
    platform,
    ready: reasons.length === 0,
    reasons,
  };
}
