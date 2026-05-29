import type { SocialPlatform } from "@/lib/db/schema";
import { listSocialAccounts } from "@/lib/social/repository";
import { getProvider } from "@/lib/social/provider-registry";
import type { CopilotContext } from "./context";

export interface CopilotChannelCapabilities {
  maxContentLength: number;
  supportsImages: boolean;
  supportsVideo: boolean;
  supportsCarousel: boolean;
  maxImages: number;
  requiresPageSelection: boolean;
}

/**
 * A connected Channel as the copilot sees it: identity + the platform
 * capabilities it needs to draft valid content. Never carries auth tokens.
 */
export interface CopilotChannel {
  id: string;
  platform: SocialPlatform;
  displayName: string;
  username: string | null;
  avatarUrl: string | null;
  requiresReauth: boolean;
  disabled: boolean;
  capabilities: CopilotChannelCapabilities;
}

/**
 * List the workspace's connected Channels with provider capabilities merged in
 * and auth tokens stripped. Backs the `listChannels` copilot tool.
 */
export async function listChannelsForWorkspace(
  ctx: CopilotContext,
): Promise<CopilotChannel[]> {
  const accounts = await listSocialAccounts(ctx.workspaceId);

  return accounts.map((account) => {
    const provider = getProvider(account.platform);
    const capabilities = provider.getCapabilities();

    return {
      id: account.id,
      platform: account.platform,
      displayName: account.displayName,
      username: account.username ?? null,
      avatarUrl: account.avatarUrl ?? null,
      requiresReauth: account.requiresReauth,
      disabled: account.disabled,
      capabilities: {
        maxContentLength: capabilities.maxContentLength,
        supportsImages: capabilities.supportsImages,
        supportsVideo: capabilities.supportsVideo,
        supportsCarousel: capabilities.supportsCarousel,
        maxImages: provider.maxImages,
        requiresPageSelection: capabilities.requiresPageSelection,
      },
    };
  });
}
