import "server-only"

import { and, desc, eq, gte } from "drizzle-orm"
import { getDb } from "@/lib/db"
import { productAnalyticsRefreshJobs, socialAccounts, socialEvents, socialPosts } from "@/lib/db/schema"
import { geoAnalyticsSourceSchema, websiteAnalyticsSourceSchema } from "./definitions"
import { listProductRecords } from "./repository"
import { listAnalyticsObservations } from "./analytics-observation-repository"
import { aggregateObservedMetric, ANALYTICS_METRIC_CONTRACTS, readObservedMetric, type AnalyticsMetric } from "./analytics-metrics"

export { ANALYTICS_METRICS, type AnalyticsMetric } from "./analytics-metrics"
export type AnalyticsSeriesMode = "daily" | "cumulative"

export async function getAudienceAnalytics(input: { workspaceId: string; days: 7 | 30 | 90; metric?: AnalyticsMetric | null; mode?: AnalyticsSeriesMode; now?: Date }) {
  const now = input.now ?? new Date()
  const from = new Date(now.getTime() - input.days * 86_400_000)
  const db = getDb()
  const [posts, events, observations, accounts, sources, refreshJobs] = await Promise.all([
    db.select().from(socialPosts).where(and(eq(socialPosts.workspaceId, input.workspaceId), gte(socialPosts.createdAt, from))).orderBy(desc(socialPosts.createdAt)),
    db.select().from(socialEvents).where(and(eq(socialEvents.workspaceId, input.workspaceId), gte(socialEvents.createdAt, from))).orderBy(desc(socialEvents.createdAt)),
    listAnalyticsObservations({ workspaceId: input.workspaceId, from }),
    db.select({ id: socialAccounts.id, platform: socialAccounts.platform, name: socialAccounts.displayName }).from(socialAccounts).where(and(eq(socialAccounts.workspaceId, input.workspaceId), eq(socialAccounts.disabled, false))),
    listProductRecords({ workspaceId: input.workspaceId, kinds: ["website_analytics_source", "geo_analytics_source"] }),
    db.select().from(productAnalyticsRefreshJobs).where(eq(productAnalyticsRefreshJobs.workspaceId, input.workspaceId)).orderBy(desc(productAnalyticsRefreshJobs.requestedAt), desc(productAnalyticsRefreshJobs.id)),
  ])
  const totals = {
    views: aggregateObservedMetric(events, "views"), likes: aggregateObservedMetric(events, "likes"), comments: aggregateObservedMetric(events, "comments"),
    posts: posts.length, websiteViews: aggregateObservations(observations, "websiteViews"), geoCitations: aggregateObservations(observations, "geoCitations"),
  }
  const seriesMode = input.mode ?? "daily"
  const perDay = buildAnalyticsSeries({ days: input.days, from, posts, events, observations, mode: seriesMode })
  const accountBreakdown = accounts.map((account) => {
    const accountEvents = events.filter((event) => event.accountId === account.id)
    return { ...account, posts: posts.filter((post) => post.socialAccountId === account.id).length, views: aggregateObservedMetric(accountEvents, "views"), likes: aggregateObservedMetric(accountEvents, "likes"), comments: aggregateObservedMetric(accountEvents, "comments") }
  })
  const platformBreakdown = Object.values(accountBreakdown.reduce<Record<string, { platform: string; accounts: number; posts: number; views: number | null; likes: number | null; comments: number | null }>>((result, account) => {
    const current = result[account.platform] ?? { platform: account.platform, accounts: 0, posts: 0, views: null, likes: null, comments: null }
    current.accounts += 1; current.posts += account.posts
    current.views = sumKnown(current.views, account.views); current.likes = sumKnown(current.likes, account.likes); current.comments = sumKnown(current.comments, account.comments)
    result[account.platform] = current
    return result
  }, {}))
  const contentTypeBreakdown = counted(posts.map((post) => post.kind || "post"))
  const publishingBreakdown = counted(posts.map((post) => post.status))
  const selected = input.metric === "posts"
    ? posts.map((post) => ({ id: post.id, occurredAt: post.createdAt, source: "publishing_records", label: post.status, value: 1 }))
    : input.metric === "websiteViews" || input.metric === "geoCitations"
      ? observations.filter((observation) => observation.metric === input.metric).map((observation) => ({ id: observation.id, occurredAt: observation.occurredAt, source: observation.sourceId, label: observation.eventType, value: observation.value }))
      : input.metric
        ? events.flatMap((event) => { const value = readObservedMetric(event.metadata, input.metric!); return value === null ? [] : [{ id: event.id, occurredAt: event.createdAt, source: event.provider ?? "workspace", label: event.eventType, value }] })
        : []
  const drilldown = selected.slice(0, 100)
  const drilldownScope = { returned: drilldown.length, total: selected.length, truncated: selected.length > drilldown.length }
  type SourceRow = (typeof sources)[number]
  type SourceModel =
    | (Omit<SourceRow, "kind" | "payload"> & { kind: "website_analytics_source"; payload: ReturnType<typeof websiteAnalyticsSourceSchema.parse>; evidence: SourceEvidenceScope; refreshJob: SourceRefreshJob | null })
    | (Omit<SourceRow, "kind" | "payload"> & { kind: "geo_analytics_source"; payload: ReturnType<typeof geoAnalyticsSourceSchema.parse>; evidence: SourceEvidenceScope; refreshJob: SourceRefreshJob | null })
  const sourceModels: SourceModel[] = []
  for (const source of sources) {
    const sourceObservations = observations.filter((observation) => observation.sourceId === source.id && observation.sourceRevision === source.revision)
    const latest = sourceObservations.at(-1)
    const refreshJob = refreshJobs.find((job) => job.sourceId === source.id) ?? null
    const refresh = refreshJob ? sourceRefreshJob(refreshJob) : null
    const evidence = sourceEvidenceScope(source.id, source.revision, sourceObservations)
    if (source.kind === "website_analytics_source") { const payload = websiteAnalyticsSourceSchema.parse(source.payload); sourceModels.push({ ...source, kind: "website_analytics_source", payload: withObservationFreshness(payload, latest?.capturedAt ?? null, "lastEventAt", refresh), evidence, refreshJob: refresh }) }
    if (source.kind === "geo_analytics_source") { const payload = geoAnalyticsSourceSchema.parse(source.payload); sourceModels.push({ ...source, kind: "geo_analytics_source", payload: withObservationFreshness(payload, latest?.capturedAt ?? null, "lastObservationAt", refresh), evidence, refreshJob: refresh }) }
  }
  const freshness = [events[0]?.createdAt, observations.at(-1)?.capturedAt].filter((value): value is Date => Boolean(value)).sort((left, right) => right.getTime() - left.getTime())[0] ?? null
  const evidenceScope = {
    complete: true, from, to: now, socialEvents: events.length, publishingRecords: posts.length, signedObservations: observations.length,
    sourceRevisions: sourceModels.map((source) => ({ id: source.id, revision: source.revision })),
    regions: unique(observations.map((row) => row.scope.region)), consentRevisions: unique(observations.map((row) => row.scope.consentRevision)), retentionUntil: earliestDate(observations.map((row) => row.scope.retentionUntil)),
    campaignTags: unique(observations.flatMap((row) => row.scope.campaignTag ? [row.scope.campaignTag] : [])), contentTypes: unique(observations.map((row) => row.scope.contentType)), platforms: unique(observations.map((row) => row.scope.platform)), publishingStates: unique(observations.map((row) => row.scope.publishingState)),
  }
  return { range: { from, to: now, days: input.days }, totals, contracts: ANALYTICS_METRIC_CONTRACTS, perDay, seriesMode, platform: accountBreakdown, breakdowns: { platforms: platformBreakdown, accounts: accountBreakdown, contentTypes: contentTypeBreakdown, publishingStates: publishingBreakdown }, evidenceScope, sources: sourceModels, drilldown, drilldownScope, selectedMetric: input.metric ?? null, freshness, empty: posts.length === 0 && events.length === 0 && observations.length === 0 }
}

type SeriesPost = { createdAt: Date }
type SeriesEvent = { createdAt: Date; metadata: Record<string, unknown> | null }
type SeriesObservation = { windowEndedAt: Date; metric: string; value: number }

export function buildAnalyticsSeries(input: { days: number; from: Date; posts: SeriesPost[]; events: SeriesEvent[]; observations: SeriesObservation[]; mode: AnalyticsSeriesMode }) {
  let cumulativePosts = 0; let cumulativeViews = 0; let cumulativeWebsiteViews = 0; let hasViews = false; let hasWebsiteViews = false
  return Array.from({ length: input.days }, (_, offset) => {
    const day = new Date(input.from.getTime() + (offset + 1) * 86_400_000)
    const key = day.toISOString().slice(0, 10)
    const posts = input.posts.filter((post) => post.createdAt.toISOString().slice(0, 10) === key).length
    const events = input.events.filter((event) => event.createdAt.toISOString().slice(0, 10) === key)
    const observations = input.observations.filter((observation) => observation.windowEndedAt.toISOString().slice(0, 10) === key)
    const views = aggregateObservedMetric(events, "views")
    const websiteViews = aggregateObservations(observations, "websiteViews")
    if (input.mode === "daily") return { date: key, posts, views, websiteViews }
    cumulativePosts += posts
    if (views !== null) { hasViews = true; cumulativeViews += views }
    if (websiteViews !== null) { hasWebsiteViews = true; cumulativeWebsiteViews += websiteViews }
    return { date: key, posts: cumulativePosts, views: hasViews ? cumulativeViews : null, websiteViews: hasWebsiteViews ? cumulativeWebsiteViews : null }
  })
}

function aggregateObservations(rows: Array<{ metric: string; value: number }>, metric: "websiteViews" | "geoCitations") { const values = rows.filter((row) => row.metric === metric).map((row) => row.value); return values.length ? values.reduce((total, value) => total + value, 0) : null }
function counted(values: string[]) { return Object.entries(values.reduce<Record<string, number>>((result, value) => { result[value] = (result[value] ?? 0) + 1; return result }, {})).map(([key, count]) => ({ key, count })).sort((left, right) => right.count - left.count || left.key.localeCompare(right.key)) }
function sumKnown(left: number | null, right: number | null) { return right === null ? left : (left ?? 0) + right }
function unique(values: string[]) { return [...new Set(values)].sort() }
function earliestDate(values: string[]) { return values.length ? values.sort()[0] : null }

type SourceEvidenceScope = ReturnType<typeof sourceEvidenceScope>
type SourceRefreshJob = ReturnType<typeof sourceRefreshJob>
function sourceEvidenceScope(sourceId: string, sourceRevision: number, rows: Array<{ capturedAt: Date; occurredAt: Date; scope: { region: string; consentRevision: string; retentionUntil: string; campaignTag: string | null; contentType: string; platform: string; publishingState: string } }>) {
  return { sourceId, sourceRevision, eventCount: rows.length, occurredFrom: rows[0]?.occurredAt ?? null, occurredTo: rows.at(-1)?.occurredAt ?? null, capturedFrom: rows[0]?.capturedAt ?? null, capturedTo: rows.at(-1)?.capturedAt ?? null, regions: unique(rows.map((row) => row.scope.region)), consentRevisions: unique(rows.map((row) => row.scope.consentRevision)), retentionUntil: earliestDate(rows.map((row) => row.scope.retentionUntil)), campaignTags: unique(rows.flatMap((row) => row.scope.campaignTag ? [row.scope.campaignTag] : [])), contentTypes: unique(rows.map((row) => row.scope.contentType)), platforms: unique(rows.map((row) => row.scope.platform)), publishingStates: unique(rows.map((row) => row.scope.publishingState)) }
}
function sourceRefreshJob(row: typeof productAnalyticsRefreshJobs.$inferSelect) { return { id: row.id, state: row.state, sourceRevision: row.sourceRevision, processedEvents: row.processedEvents, cursor: row.cursor, attempt: row.attempt, maxAttempts: row.maxAttempts, requestedAt: row.requestedAt, updatedAt: row.updatedAt, errorCode: row.lastErrorCode } }
function refreshStatus(job: SourceRefreshJob): "queued" | "running" | "succeeded" | "failed" { if (job.state === "succeeded") return "succeeded"; if (job.state === "failed_known" || job.state === "outcome_unknown") return "failed"; if (job.state === "claimed" || job.state === "running") return "running"; return "queued" }
function withObservationFreshness<T extends { refreshRequestedAt: string | null; refreshStatus: "idle" | "queued" | "running" | "succeeded" | "failed"; lastRefreshAt: string | null; lastRefreshError: string | null }, K extends "lastEventAt" | "lastObservationAt">(payload: T, observedAt: Date | null, field: K, job: SourceRefreshJob | null): T & Record<K, string | null> {
  const jobStatus = job ? refreshStatus(job) : payload.refreshStatus
  return { ...payload, [field]: observedAt?.toISOString() ?? null, refreshStatus: jobStatus, lastRefreshAt: job?.state === "succeeded" ? job.updatedAt.toISOString() : payload.lastRefreshAt, lastRefreshError: job?.errorCode ?? payload.lastRefreshError } as T & Record<K, string | null>
}
