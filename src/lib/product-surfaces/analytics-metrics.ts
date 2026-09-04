export const ANALYTICS_METRICS = ["views", "likes", "comments", "posts", "websiteViews", "geoCitations"] as const
export type AnalyticsMetric = (typeof ANALYTICS_METRICS)[number]

export const ANALYTICS_METRIC_CONTRACTS: Record<AnalyticsMetric, { unit: "count"; source: "social_provider" | "publishing_records" | "website_collector" | "geo_observation"; comparisonGroup: string }> = {
  views: { unit: "count", source: "social_provider", comparisonGroup: "social_provider_observations" },
  likes: { unit: "count", source: "social_provider", comparisonGroup: "social_provider_observations" },
  comments: { unit: "count", source: "social_provider", comparisonGroup: "social_provider_observations" },
  posts: { unit: "count", source: "publishing_records", comparisonGroup: "workspace_publishing_records" },
  websiteViews: { unit: "count", source: "website_collector", comparisonGroup: "verified_website_observations" },
  geoCitations: { unit: "count", source: "geo_observation", comparisonGroup: "verified_geo_observations" },
}

function metric(metadata: Record<string, unknown> | null, key: AnalyticsMetric): number | null {
  const value = metadata?.[key]
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null
}

export function aggregateObservedMetric(events: Array<{ metadata: Record<string, unknown> | null }>, key: Exclude<AnalyticsMetric, "posts">): number | null {
  const values = events.map((event) => metric(event.metadata, key)).filter((value): value is number => value !== null)
  return values.length ? values.reduce((sum, value) => sum + value, 0) : null
}

export function readObservedMetric(metadata: Record<string, unknown> | null, key: AnalyticsMetric): number | null {
  return metric(metadata, key)
}
