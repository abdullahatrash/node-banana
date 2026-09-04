export function chooseDashboardNextAction(input: { brand: boolean; media: number; channels: number; failedPublishing: number; content: number; scheduled: number }) {
  if (!input.brand) return { key: "brand", href: "/brand", reason: "brand_missing" } as const;
  if (input.media === 0) return { key: "media", href: "/ai-studio", reason: "media_missing" } as const;
  if (input.channels === 0) return { key: "channel", href: "/channels", reason: "channel_missing" } as const;
  if (input.failedPublishing > 0) return { key: "failure", href: "/deliveries", reason: "publishing_failure" } as const;
  if (input.content === 0) return { key: "content", href: "/blitz", reason: "content_missing" } as const;
  if (input.scheduled === 0) return { key: "schedule", href: "/compose", reason: "schedule_missing" } as const;
  return { key: "insights", href: "/analytics", reason: "workspace_ready" } as const;
}
