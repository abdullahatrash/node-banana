import { createHash, createHmac, timingSafeEqual } from "node:crypto"
import { z } from "zod"

const digestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/)
const eventIdSchema = z.string().trim().min(8).max(200).regex(/^[A-Za-z0-9._:-]+$/)
const signatureSchema = z.string().regex(/^hmac-sha256:[a-f0-9]{64}$/)
const occurredAtSchema = z.string().datetime({ offset: true })

export const analyticsReceiptScopeSchema = z.object({
  region: z.enum(["mena", "eu", "other", "unknown"]),
  consentRevision: z.string().trim().min(1).max(100),
  consentPurpose: z.literal("analytics"),
  retentionUntil: z.string().datetime({ offset: true }),
  campaignTag: z.string().trim().min(1).max(100).regex(/^[A-Za-z0-9._:-]+$/).nullable(),
  contentType: z.enum(["page", "article", "landing_page", "social_post", "video", "image", "other"]),
  platform: z.enum(["website", "google", "bing", "chatgpt", "perplexity", "other"]),
  accountRefDigest: digestSchema.nullable(),
  publishingState: z.enum(["not_applicable", "draft", "queued", "publishing", "published", "failed"]),
}).strict()

const websiteEventSchema = z.object({ eventId: eventIdSchema, eventType: z.literal("page_view"), occurredAt: occurredAtSchema, scope: analyticsReceiptScopeSchema, signature: signatureSchema }).strict()
const geoEventSchema = z.object({ sourceId: z.string().trim().min(1).max(200), sourceRevision: z.number().int().positive(), eventId: eventIdSchema, eventType: z.literal("citation_observed"), occurredAt: occurredAtSchema, topicDigest: digestSchema, evidenceDigest: digestSchema, scope: analyticsReceiptScopeSchema, signature: signatureSchema }).strict()

export type WebsiteObservationInput = z.infer<typeof websiteEventSchema>
export type GeoObservationInput = z.infer<typeof geoEventSchema>
export type AnalyticsReceiptScope = z.infer<typeof analyticsReceiptScopeSchema>
export type VerifiedAnalyticsSource = { workspaceId: string; sourceId: string; revision: number; kind: "website_analytics_source" | "geo_analytics_source"; hostname: string; enabled: boolean; verificationStatus: "pending" | "verified" | "failed" }
export type AnalyticsObservation = { workspaceId: string; sourceId: string; sourceRevision: number; sourceKind: VerifiedAnalyticsSource["kind"]; eventId: string; eventType: "page_view" | "citation_observed"; occurredAt: Date; metric: "websiteViews" | "geoCitations"; value: 1; windowStartedAt: Date; windowEndedAt: Date; capturedAt: Date; evidenceDigest: `sha256:${string}`; credentialDigest: `sha256:${string}`; receiptSignature: `hmac-sha256:${string}`; scope: AnalyticsReceiptScope; idempotencyKey: string; requestDigest: `sha256:${string}` }

export type AnalyticsObservationErrorCode = "ANALYTICS_OBSERVATION_INVALID" | "ANALYTICS_SOURCE_NOT_VERIFIED" | "ANALYTICS_SOURCE_ORIGIN_MISMATCH" | "ANALYTICS_SOURCE_REVISION_MISMATCH" | "ANALYTICS_OBSERVATION_IN_FUTURE" | "ANALYTICS_OBSERVATION_EXPIRED" | "ANALYTICS_RECEIPT_SIGNATURE_INVALID" | "ANALYTICS_RECEIPT_CREDENTIAL_UNAVAILABLE"
export class AnalyticsObservationError extends Error { constructor(readonly code: AnalyticsObservationErrorCode) { super(code) } }

export function admitWebsiteObservation(input: unknown, context: { source: VerifiedAnalyticsSource; origin: string | null; credential: string; now?: Date }): AnalyticsObservation {
  const parsed = websiteEventSchema.safeParse(input)
  if (!parsed.success) throw new AnalyticsObservationError("ANALYTICS_OBSERVATION_INVALID")
  assertVerifiedSource(context.source, "website_analytics_source")
  if (normalizeOriginHostname(context.origin) !== normalizeHostname(context.source.hostname)) throw new AnalyticsObservationError("ANALYTICS_SOURCE_ORIGIN_MISMATCH")
  const now = context.now ?? new Date()
  assertReceiptTime(parsed.data.occurredAt, parsed.data.scope.retentionUntil, now)
  const signedPayload = { eventId: parsed.data.eventId, eventType: parsed.data.eventType, occurredAt: parsed.data.occurredAt, scope: parsed.data.scope }
  assertSignature(signedPayload, parsed.data.signature, context.credential)
  return buildObservation({ source: context.source, eventId: parsed.data.eventId, eventType: parsed.data.eventType, occurredAt: new Date(parsed.data.occurredAt), metric: "websiteViews", evidenceDigest: canonicalObservationDigest(signedPayload), scope: parsed.data.scope, signature: parsed.data.signature as `hmac-sha256:${string}`, credential: context.credential, capturedAt: now })
}

export function admitGeoObservation(input: unknown, context: { source: VerifiedAnalyticsSource; credential: string; now?: Date }): AnalyticsObservation {
  const parsed = geoEventSchema.safeParse(input)
  if (!parsed.success) throw new AnalyticsObservationError("ANALYTICS_OBSERVATION_INVALID")
  assertVerifiedSource(context.source, "geo_analytics_source")
  if (parsed.data.sourceRevision !== context.source.revision) throw new AnalyticsObservationError("ANALYTICS_SOURCE_REVISION_MISMATCH")
  const now = context.now ?? new Date()
  assertReceiptTime(parsed.data.occurredAt, parsed.data.scope.retentionUntil, now)
  const signedPayload = { sourceId: parsed.data.sourceId, sourceRevision: parsed.data.sourceRevision, eventId: parsed.data.eventId, eventType: parsed.data.eventType, occurredAt: parsed.data.occurredAt, topicDigest: parsed.data.topicDigest, evidenceDigest: parsed.data.evidenceDigest, scope: parsed.data.scope }
  assertSignature(signedPayload, parsed.data.signature, context.credential)
  return buildObservation({ source: context.source, eventId: parsed.data.eventId, eventType: parsed.data.eventType, occurredAt: new Date(parsed.data.occurredAt), metric: "geoCitations", evidenceDigest: parsed.data.evidenceDigest as `sha256:${string}`, scope: parsed.data.scope, signature: parsed.data.signature as `hmac-sha256:${string}`, credential: context.credential, capturedAt: now })
}

export function signAnalyticsReceipt(payload: Record<string, unknown>, credential: string): `hmac-sha256:${string}` { return `hmac-sha256:${createHmac("sha256", credential).update(stableJson(payload)).digest("hex")}` }

function buildObservation(input: { source: VerifiedAnalyticsSource; eventId: string; eventType: AnalyticsObservation["eventType"]; occurredAt: Date; metric: AnalyticsObservation["metric"]; evidenceDigest: `sha256:${string}`; scope: AnalyticsReceiptScope; signature: `hmac-sha256:${string}`; credential: string; capturedAt: Date }): AnalyticsObservation {
  const windowStartedAt = new Date(input.occurredAt); windowStartedAt.setUTCMinutes(0, 0, 0)
  const windowEndedAt = new Date(windowStartedAt.getTime() + 3_600_000)
  const unsigned = { workspaceId: input.source.workspaceId, sourceId: input.source.sourceId, sourceRevision: input.source.revision, sourceKind: input.source.kind, eventId: input.eventId, eventType: input.eventType, occurredAt: input.occurredAt.toISOString(), metric: input.metric, value: 1 as const, windowStartedAt: windowStartedAt.toISOString(), windowEndedAt: windowEndedAt.toISOString(), capturedAt: input.capturedAt.toISOString(), evidenceDigest: input.evidenceDigest, credentialDigest: canonicalObservationDigest(input.credential), receiptSignature: input.signature, scope: input.scope, idempotencyKey: `event:${input.eventId}` }
  return { ...unsigned, occurredAt: input.occurredAt, windowStartedAt, windowEndedAt, capturedAt: input.capturedAt, requestDigest: canonicalObservationDigest(unsigned) }
}

function assertVerifiedSource(source: VerifiedAnalyticsSource, kind: VerifiedAnalyticsSource["kind"]) { if (source.kind !== kind || !source.enabled || source.verificationStatus !== "verified") throw new AnalyticsObservationError("ANALYTICS_SOURCE_NOT_VERIFIED") }
function assertReceiptTime(occurredAt: string, retentionUntil: string, now: Date) { const eventTime = Date.parse(occurredAt); if (eventTime > now.getTime() + 5 * 60_000) throw new AnalyticsObservationError("ANALYTICS_OBSERVATION_IN_FUTURE"); if (eventTime < now.getTime() - 7 * 86_400_000 || Date.parse(retentionUntil) <= now.getTime()) throw new AnalyticsObservationError("ANALYTICS_OBSERVATION_EXPIRED") }
function assertSignature(payload: Record<string, unknown>, signature: string, credential: string) { if (credential.trim().length < 32) throw new AnalyticsObservationError("ANALYTICS_RECEIPT_CREDENTIAL_UNAVAILABLE"); const expected = signAnalyticsReceipt(payload, credential); const left = Buffer.from(signature); const right = Buffer.from(expected); if (left.length !== right.length || !timingSafeEqual(left, right)) throw new AnalyticsObservationError("ANALYTICS_RECEIPT_SIGNATURE_INVALID") }
function normalizeOriginHostname(origin: string | null) { if (!origin) return null; try { const url = new URL(origin); if (url.protocol !== "https:" || url.port || url.username || url.password || url.pathname !== "/" || url.search || url.hash) return null; return normalizeHostname(url.hostname) } catch { return null } }
function normalizeHostname(hostname: string) { return hostname.trim().toLowerCase().replace(/\.$/, "") }
function canonicalObservationDigest(value: unknown): `sha256:${string}` { return `sha256:${createHash("sha256").update(stableJson(value)).digest("hex")}` }
function stableJson(value: unknown): string { if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`; if (value && typeof value === "object") return `{${Object.entries(value).filter(([, item]) => item !== undefined).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`; return JSON.stringify(value) }
