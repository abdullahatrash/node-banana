import { describe, expect, it } from "vitest"
import {
  buildDashboardSourceEnvelopes,
  dashboardReviewHref,
  projectDashboardContentPiece,
} from "../dashboard-projection"

describe("dashboard projections", () => {
  it("keeps each source status and guidance input independent", () => {
    const envelopes = buildDashboardSourceEnvelopes({
      brand: { active: true, updatedAt: new Date("2026-01-01T00:00:00Z") },
      media: { count: 0, updatedAt: null },
      channels: { count: 2, reauth: 1, updatedAt: new Date("2026-01-02T00:00:00Z") },
      content: { count: 3, updatedAt: new Date("2026-01-03T00:00:00Z") },
      publishing: { scheduled: 4, failures: 0, updatedAt: new Date("2026-01-04T00:00:00Z") },
    })
    expect(envelopes.map(({ source, status }) => [source, status])).toEqual([
      ["brand", "ready"], ["media", "missing"], ["channels", "attention"],
      ["content", "ready"], ["publishing", "ready"],
    ])
  })

  it("rejects malformed content payloads instead of inventing dashboard facts", () => {
    const base = { id: "content_1", title: "Launch", revision: 2, updatedAt: new Date() }
    expect(projectDashboardContentPiece({ ...base, payload: {} })).toBeNull()
    expect(projectDashboardContentPiece({ ...base, payload: { format: "invented", contentLanguage: "ar", renderProofStatus: "passed" } })).toBeNull()
    expect(projectDashboardContentPiece({ ...base, payload: { format: "slideshow", contentLanguage: "ar", renderProofStatus: "passed" } }))
      .toMatchObject({ format: "slideshow", contentLanguage: "ar", renderProofStatus: "passed" })
  })

  it("routes each durable review kind to its authoritative surface", () => {
    expect(dashboardReviewHref("blitz_item", "b1")).toBe("/blitz")
    expect(dashboardReviewHref("creator_persona", "p 1")).toBe("/influencers?persona=p%201")
    expect(dashboardReviewHref("channel_onboarding_order", "o1")).toBe("/channels/onboarding?order=o1")
  })
})
