import "server-only"

import { and, desc, eq, gte } from "drizzle-orm"
import { getDb } from "@/lib/db"
import { socialAccounts, socialEvents, socialPosts } from "@/lib/db/schema"
import { geoAnalyticsSourceSchema, websiteAnalyticsSourceSchema } from "./definitions"
import { listProductRecords } from "./repository"
import { aggregateObservedMetric, ANALYTICS_METRIC_CONTRACTS, readObservedMetric, type AnalyticsMetric } from "./analytics-metrics"

export { ANALYTICS_METRICS, type AnalyticsMetric } from "./analytics-metrics"

export async function getAudienceAnalytics(input: { workspaceId: string; days: 7 | 30 | 90; metric?: AnalyticsMetric | null; now?: Date }) {
  const now = input.now ?? new Date()
  const from = new Date(now.getTime() - input.days * 86_400_000)
  const db = getDb()
  const [posts, events, accounts, sources] = await Promise.all([
    db.select().from(socialPosts).where(and(eq(socialPosts.workspaceId, input.workspaceId), gte(socialPosts.createdAt, from))).orderBy(desc(socialPosts.createdAt)),
    db.select().from(socialEvents).where(and(eq(socialEvents.workspaceId, input.workspaceId), gte(socialEvents.createdAt, from))).orderBy(desc(socialEvents.createdAt)).limit(2_000),
    db.select({ id: socialAccounts.id, platform: socialAccounts.platform, name: socialAccounts.displayName }).from(socialAccounts).where(and(eq(socialAccounts.workspaceId, input.workspaceId), eq(socialAccounts.disabled, false))),
    listProductRecords({ workspaceId: input.workspaceId, kinds: ["website_analytics_source", "geo_analytics_source"] }),
  ])
  const totals = {
    views: aggregateObservedMetric(events, "views"), likes: aggregateObservedMetric(events, "likes"), comments: aggregateObservedMetric(events, "comments"),
    posts: posts.length, websiteViews: aggregateObservedMetric(events, "websiteViews"), geoCitations: aggregateObservedMetric(events, "geoCitations"),
  }
  const perDay = Array.from({ length: input.days }, (_, offset) => {
    const day = new Date(from.getTime() + (offset + 1) * 86_400_000)
    const key = day.toISOString().slice(0, 10)
    const dayPosts = posts.filter((post) => post.createdAt.toISOString().slice(0, 10) === key)
    const dayEvents = events.filter((event) => event.createdAt.toISOString().slice(0, 10) === key)
    return { date: key, posts: dayPosts.length, views: aggregateObservedMetric(dayEvents, "views") ?? 0, websiteViews: aggregateObservedMetric(dayEvents, "websiteViews") ?? 0 }
  })
  const platform = accounts.map((account) => ({ ...account, posts: posts.filter((post) => post.socialAccountId === account.id).length }))
  const drilldown = input.metric === "posts"
    ? posts.slice(0, 100).map((post) => ({ id: post.id, occurredAt: post.createdAt, source: "publishing_records", label: post.status, value: 1 }))
    : input.metric
      ? events.flatMap((event) => { const value = readObservedMetric(event.metadata, input.metric!); return value === null ? [] : [{ id: event.id, occurredAt: event.createdAt, source: event.provider ?? "workspace", label: event.eventType, value }] }).slice(0, 100)
      : []
  type SourceRow = (typeof sources)[number]
  type SourceModel =
    | (Omit<SourceRow, "kind" | "payload"> & { kind: "website_analytics_source"; payload: ReturnType<typeof websiteAnalyticsSourceSchema.parse> })
    | (Omit<SourceRow, "kind" | "payload"> & { kind: "geo_analytics_source"; payload: ReturnType<typeof geoAnalyticsSourceSchema.parse> })
  const sourceModels: SourceModel[] = []
  for (const source of sources) {
    if (source.kind === "website_analytics_source") sourceModels.push({ ...source, kind: "website_analytics_source", payload: websiteAnalyticsSourceSchema.parse(source.payload) })
    if (source.kind === "geo_analytics_source") sourceModels.push({ ...source, kind: "geo_analytics_source", payload: geoAnalyticsSourceSchema.parse(source.payload) })
  }
  return { range: { from, to: now, days: input.days }, totals, contracts: ANALYTICS_METRIC_CONTRACTS, perDay, platform, sources: sourceModels, drilldown, selectedMetric: input.metric ?? null, freshness: events[0]?.createdAt ?? null, empty: posts.length === 0 && events.length === 0 }
}
