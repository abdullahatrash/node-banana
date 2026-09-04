export function chooseDashboardNextAction(input: { brand: boolean; media: number; channels: number; failedPublishing: number; content: number; scheduled: number }) {
  if (!input.brand) return { key: "brand" as const, href: "/brand", reason: "brand_missing" };
  if (input.media === 0) return { key: "media" as const, href: "/ai-studio", reason: "media_missing" };
  if (input.channels === 0) return { key: "channel" as const, href: "/channels", reason: "channel_missing" };
  if (input.failedPublishing > 0) return { key: "failure" as const, href: "/deliveries", reason: "publishing_failure" };
  if (input.content === 0) return { key: "content" as const, href: "/blitz", reason: "content_missing" };
  if (input.scheduled === 0) return { key: "schedule" as const, href: "/compose", reason: "schedule_missing" };
  return { key: "insights" as const, href: "/analytics", reason: "workspace_ready" };
}
