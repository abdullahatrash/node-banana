import { NextResponse } from "next/server";
import "@/lib/social/runtime-bootstrap";
import { getWorkspaceChannelEntitlement } from "@/lib/commercial/channel-entitlement";
import { listProviderCapabilities } from "@/lib/social/provider-registry";
import { listSocialAccounts } from "@/lib/social/repository";
import type { WorkspaceChannelSummary } from "@/lib/social/channel-summary";
import { withStudioAuth } from "@/lib/studio/withStudioAuth";

export const GET = withStudioAuth<undefined>(
  { route: "/api/social/channels/summary", action: "read", permission: "social:view" },
  async (_request, authz) => {
    const [entitlement, accounts] = await Promise.all([
      getWorkspaceChannelEntitlement(authz.workspaceId),
      listSocialAccounts(authz.workspaceId),
    ]);
    const activeAccounts = accounts.filter((account) => !account.disabled);
    const usage = {
      active: activeAccounts.length,
      healthy: activeAccounts.filter((account) => !account.requiresReauth).length,
      requiresReauth: activeAccounts.filter((account) => account.requiresReauth).length,
      disabled: accounts.filter((account) => account.disabled).length,
      remaining: Math.max(0, entitlement.connectedChannels - activeAccounts.length),
    };
    const summary: WorkspaceChannelSummary = {
      entitlement,
      usage,
      providers: listProviderCapabilities().map((provider) => ({
        identifier: provider.identifier,
        displayName: provider.displayName,
        configured: provider.configured !== false,
        connected: activeAccounts.filter((account) => account.platform === provider.identifier).length,
        supportsImages: provider.supportsImages,
        supportsVideo: provider.supportsVideo,
        supportsCarousel: provider.supportsCarousel,
        supportsPostMetrics: provider.supportsPostMetrics === true,
      })),
      measuredAt: new Date().toISOString(),
    };

    return NextResponse.json(
      { success: true, data: summary },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  },
);
