export interface DashboardAttentionInput {
  brand: boolean
  media: number
  channels: number
  reauth: number
  failedPublishing: number
  failedGeneration: number
  consentAttention: number
  pendingApprovals: number
  acceptedContent: number
  scheduled: number
  creditCapacity: "available" | "depleted" | "unavailable"
  metricsStale: boolean
}

export function chooseDashboardNextAction(input: DashboardAttentionInput) {
  if (!input.brand) return { key: "brand", href: "/brand", reason: "brand_missing" } as const;
  if (input.media === 0) return { key: "media", href: "/ai-studio", reason: "media_missing" } as const;
  if (input.channels === 0) return { key: "channel", href: "/channels", reason: "channel_missing" } as const;
  if (input.reauth > 0) return { key: "reauth", href: "/channels", reason: "channel_reauth" } as const;
  if (input.failedPublishing > 0) return { key: "publishingFailure", href: "/deliveries", reason: "publishing_failure" } as const;
  if (input.failedGeneration > 0) return { key: "generationFailure", href: "/studio/operations", reason: "generation_failure" } as const;
  if (input.consentAttention > 0) return { key: "consent", href: "/influencers", reason: "consent_attention" } as const;
  if (input.pendingApprovals > 0) return { key: "approval", href: "/approvals", reason: "approval_pending" } as const;
  if (input.acceptedContent === 0) return { key: "content", href: "/blitz", reason: "content_missing" } as const;
  if (input.scheduled === 0) return { key: "schedule", href: "/compose", reason: "schedule_missing" } as const;
  if (input.creditCapacity === "depleted") return { key: "credits", href: "/settings?section=billing", reason: "credits_depleted" } as const;
  if (input.metricsStale) return { key: "metrics", href: "/analytics", reason: "metrics_stale" } as const;
  return { key: "insights", href: "/analytics", reason: "workspace_ready" } as const;
}
