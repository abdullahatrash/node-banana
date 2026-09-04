import { CONTENT_FORMATS, contentPieceSchema, type ContentFormat, type ProductRecordKind } from "./definitions"

export type DashboardSource = "brand" | "media" | "channels" | "content" | "publishing"
export type DashboardSourceStatus = "ready" | "missing" | "attention"
export const DASHBOARD_REVIEW_KINDS = ["blitz_item", "campaign_automation", "creator_persona", "channel_onboarding_order"] as const satisfies readonly ProductRecordKind[]
export type DashboardReviewKind = (typeof DASHBOARD_REVIEW_KINDS)[number]

export function isDashboardReviewKind(value: ProductRecordKind): value is DashboardReviewKind {
  return DASHBOARD_REVIEW_KINDS.includes(value as DashboardReviewKind)
}

export interface DashboardSourceEnvelope {
  source: DashboardSource
  status: DashboardSourceStatus
  count: number
  updatedAt: Date | null
  href: string
}

export function buildDashboardSourceEnvelopes(input: {
  brand: { active: boolean; updatedAt: Date | null }
  media: { count: number; updatedAt: Date | null }
  channels: { count: number; reauth: number; updatedAt: Date | null }
  content: { count: number; updatedAt: Date | null }
  publishing: { scheduled: number; failures: number; updatedAt: Date | null }
}): DashboardSourceEnvelope[] {
  return [
    { source: "brand", status: input.brand.active ? "ready" : "missing", count: input.brand.active ? 1 : 0, updatedAt: input.brand.updatedAt, href: "/brand" },
    { source: "media", status: input.media.count ? "ready" : "missing", count: input.media.count, updatedAt: input.media.updatedAt, href: "/library?tab=media" },
    { source: "channels", status: input.channels.reauth ? "attention" : input.channels.count ? "ready" : "missing", count: input.channels.count, updatedAt: input.channels.updatedAt, href: "/channels" },
    { source: "content", status: input.content.count ? "ready" : "missing", count: input.content.count, updatedAt: input.content.updatedAt, href: "/content" },
    { source: "publishing", status: input.publishing.failures ? "attention" : input.publishing.scheduled ? "ready" : "missing", count: input.publishing.scheduled, updatedAt: input.publishing.updatedAt, href: "/calendar" },
  ]
}

export interface DashboardContentPiece {
  id: string
  title: string
  revision: number
  format: ContentFormat
  contentLanguage: "ar" | "en" | "mixed"
  renderProofStatus: "not_requested" | "pending" | "passed" | "failed"
  updatedAt: Date
}

export function isAcceptedDashboardContent(payload: unknown): boolean {
  const parsed = contentPieceSchema.safeParse(payload)
  return parsed.success && parsed.data.renderProofStatus === "passed" && parsed.data.candidates.some((candidate) => candidate.renderProof.schema === "content-render-proof/v2" && candidate.renderProof.status === "passed")
}

export function projectDashboardContentPiece(row: {
  id: string
  title: string
  revision: number
  payload: Record<string, unknown>
  updatedAt: Date
}): DashboardContentPiece | null {
  const { format, contentLanguage, renderProofStatus } = row.payload
  if (typeof format !== "string" || !CONTENT_FORMATS.includes(format as ContentFormat)) return null
  if (contentLanguage !== "ar" && contentLanguage !== "en" && contentLanguage !== "mixed") return null
  if (renderProofStatus !== "not_requested" && renderProofStatus !== "pending" && renderProofStatus !== "passed" && renderProofStatus !== "failed") return null
  const qualified = isAcceptedDashboardContent(row.payload)
  return { ...row, format: format as ContentFormat, contentLanguage, renderProofStatus: renderProofStatus === "passed" && !qualified ? "failed" : renderProofStatus }
}

export function dashboardReviewHref(kind: DashboardReviewKind, id: string): string {
  const encoded = encodeURIComponent(id)
  if (kind === "blitz_item") return "/blitz"
  if (kind === "campaign_automation") return `/automations?campaign=${encoded}`
  if (kind === "creator_persona") return `/influencers?persona=${encoded}`
  return `/channels/onboarding?order=${encoded}`
}
