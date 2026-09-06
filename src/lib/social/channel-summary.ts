import type { SocialPlatform } from "@/lib/db/schema";

export type WorkspaceChannelSummary = {
  entitlement: {
    planId: string;
    planVersion: number;
    subscriptionState: string;
    authoredName: { ar: string; en: string };
    connectedChannels: number;
  };
  usage: {
    active: number;
    healthy: number;
    requiresReauth: number;
    disabled: number;
    remaining: number;
  };
  providers: Array<{
    identifier: SocialPlatform;
    displayName: string;
    configured: boolean;
    connected: number;
    supportsImages: boolean;
    supportsVideo: boolean;
    supportsCarousel: boolean;
    supportsPostMetrics: boolean;
  }>;
  measuredAt: string;
};
