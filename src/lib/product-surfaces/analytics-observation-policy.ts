import { createHash } from "node:crypto"
import { z } from "zod"

const digestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/)
const sourceIdSchema = z.string().trim().min(1).max(200)
const idempotencyKeySchema = z.string().trim().min(8).max(200).regex(/^[A-Za-z0-9._:-]+$/)

const observationWindowSchema = z.object({
  startedAt: z.string().datetime({ offset: true }),
  endedAt: z.string().datetime({ offset: true }),
}).strict().superRefine((window, context) => {
  const startedAt = Date.parse(window.startedAt)
  const endedAt = Date.parse(window.endedAt)
  if (endedAt <= startedAt) context.addIssue({ code: "custom", path: ["endedAt"], message: "ANALYTICS_WINDOW_INVALID" })
  if (endedAt - startedAt > 86_400_000) context.addIssue({ code: "custom", path: ["endedAt"], message: "ANALYTICS_WINDOW_TOO_LARGE" })
})

export const websiteObservationInputSchema = z.object({
  sourceKey: z.string().trim().min(32).max(300),
  idempotencyKey: idempotencyKeySchema,
  metric: z.literal("websiteViews"),
  value: z.number().int().nonnegative().max(10_000_000),
  window: observationWindowSchema,
}).strict()

export const geoObservationInputSchema = z.object({
  sourceId: sourceIdSchema,
  sourceRevision: z.number().int().positive(),
  idempotencyKey: idempotencyKeySchema,
  metric: z.literal("geoCitations"),
  value: z.number().int().nonnegative().max(10_000_000),
  window: observationWindowSchema,
  evidenceDigest: digestSchema,
}).strict()

export type WebsiteObservationInput = z.infer<typeof websiteObservationInputSchema>
export type GeoObservationInput = z.infer<typeof geoObservationInputSchema>

export type VerifiedAnalyticsSource = {
  workspaceId: string
  sourceId: string
  revision: number
  kind: "website_analytics_source" | "geo_analytics_source"
  hostname: string
  enabled: boolean
  verificationStatus: "pending" | "verified" | "failed"
}

export type AnalyticsObservation = {
  workspaceId: string
  sourceId: string
  sourceRevision: number
  sourceKind: VerifiedAnalyticsSource["kind"]
  metric: "websiteViews" | "geoCitations"
  value: number
  windowStartedAt: Date
  windowEndedAt: Date
  evidenceDigest: `sha256:${string}`
  idempotencyKey: string
  requestDigest: `sha256:${string}`
}

export class AnalyticsObservationError extends Error {
  constructor(readonly code: "ANALYTICS_OBSERVATION_INVALID" | "ANALYTICS_SOURCE_NOT_VERIFIED" | "ANALYTICS_SOURCE_ORIGIN_MISMATCH" | "ANALYTICS_SOURCE_REVISION_MISMATCH" | "ANALYTICS_OBSERVATION_IN_FUTURE") { super(code) }
}

export function admitWebsiteObservation(input: unknown, context: { source: VerifiedAnalyticsSource; origin: string | null; now?: Date }): AnalyticsObservation {
  const parsed = websiteObservationInputSchema.safeParse(input)
  if (!parsed.success) throw new AnalyticsObservationError("ANALYTICS_OBSERVATION_INVALID")
  assertVerifiedSource(context.source, "website_analytics_source")
  if (normalizeOriginHostname(context.origin) !== normalizeHostname(context.source.hostname)) throw new AnalyticsObservationError("ANALYTICS_SOURCE_ORIGIN_MISMATCH")
  assertObservationTime(parsed.data.window.endedAt, context.now)
  const requestDigest = canonicalObservationDigest({ ...parsed.data, sourceKey: undefined })
  return {
    workspaceId: context.source.workspaceId,
    sourceId: context.source.sourceId,
    sourceRevision: context.source.revision,
    sourceKind: context.source.kind,
    metric: parsed.data.metric,
    value: parsed.data.value,
    windowStartedAt: new Date(parsed.data.window.startedAt),
    windowEndedAt: new Date(parsed.data.window.endedAt),
    evidenceDigest: requestDigest,
    idempotencyKey: parsed.data.idempotencyKey,
    requestDigest,
  }
}

export function admitGeoObservation(input: unknown, context: { source: VerifiedAnalyticsSource; now?: Date }): AnalyticsObservation {
  const parsed = geoObservationInputSchema.safeParse(input)
  if (!parsed.success) throw new AnalyticsObservationError("ANALYTICS_OBSERVATION_INVALID")
  assertVerifiedSource(context.source, "geo_analytics_source")
  if (parsed.data.sourceRevision !== context.source.revision) throw new AnalyticsObservationError("ANALYTICS_SOURCE_REVISION_MISMATCH")
  assertObservationTime(parsed.data.window.endedAt, context.now)
  const requestDigest = canonicalObservationDigest(parsed.data)
  return {
    workspaceId: context.source.workspaceId,
    sourceId: context.source.sourceId,
    sourceRevision: context.source.revision,
    sourceKind: context.source.kind,
    metric: parsed.data.metric,
    value: parsed.data.value,
    windowStartedAt: new Date(parsed.data.window.startedAt),
    windowEndedAt: new Date(parsed.data.window.endedAt),
    evidenceDigest: parsed.data.evidenceDigest as `sha256:${string}`,
    idempotencyKey: parsed.data.idempotencyKey,
    requestDigest,
  }
}

function assertVerifiedSource(source: VerifiedAnalyticsSource, kind: VerifiedAnalyticsSource["kind"]) {
  if (source.kind !== kind || !source.enabled || source.verificationStatus !== "verified") throw new AnalyticsObservationError("ANALYTICS_SOURCE_NOT_VERIFIED")
}

function assertObservationTime(endedAt: string, now = new Date()) {
  if (Date.parse(endedAt) > now.getTime() + 5 * 60_000) throw new AnalyticsObservationError("ANALYTICS_OBSERVATION_IN_FUTURE")
}

function normalizeOriginHostname(origin: string | null) {
  if (!origin) return null
  try {
    const url = new URL(origin)
    if (url.protocol !== "https:" || url.port || url.username || url.password || url.pathname !== "/" || url.search || url.hash) return null
    return normalizeHostname(url.hostname)
  } catch { return null }
}

function normalizeHostname(hostname: string) {
  return hostname.trim().toLowerCase().replace(/\.$/, "")
}

function canonicalObservationDigest(value: unknown): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(stableJson(value)).digest("hex")}`
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`
  if (value && typeof value === "object") return `{${Object.entries(value).filter(([, item]) => item !== undefined).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`
  return JSON.stringify(value)
}
