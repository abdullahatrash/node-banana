import { describe, expect, it } from "vitest"
import {
  buildDashboardSourceEnvelopes,
  dashboardReviewHref,
  dashboardContentRevisionDigest,
  hasQualifiedDashboardRenderProof,
  isAcceptedDashboardContent,
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
      .toMatchObject({ format: "slideshow", contentLanguage: "ar", renderProofStatus: "failed" })
  })

  it("requires both an exact accepted Content Piece Revision and a qualified v2 Render Proof", () => {
    expect(hasQualifiedDashboardRenderProof({ format: "slideshow", contentLanguage: "ar", renderProofStatus: "passed", candidates: [] })).toBe(false)
    const legacy = { assetId: "asset", intentId: null, operationId: null, contentDigest: `sha256:${"a".repeat(64)}`, createdAt: "2026-01-01T00:00:00.000Z", renderProof: { schema: "content-render-proof/v1", status: "passed", inputAssets: [], output: { assetId: "asset", contentDigest: `sha256:${"b".repeat(64)}`, width: 1080, height: 1920, durationSeconds: 15 }, intentId: null, operationId: null, verifiedAt: "2026-01-01T00:00:00.000Z", digest: `sha256:${"c".repeat(64)}` } }
    expect(hasQualifiedDashboardRenderProof({ format: "slideshow", contentLanguage: "ar", renderProofStatus: "passed", candidates: [legacy] })).toBe(false)
    const digest = `sha256:${"d".repeat(64)}`
    const qualified = { ...legacy, renderProof: { schema: "content-render-proof/v2", status: "passed", formatDefinition: { id: "content-format:slideshow", revision: 1, digest }, inputAssets: [], output: { assetId: "asset", contentDigest: digest, width: 1080, height: 1920, durationSeconds: 15 }, checks: { fonts: { status: "passed", fontManifestDigest: digest, missingGlyphCount: 0 }, bidi: { status: "passed", paragraphCount: 1, visualOrderDigest: digest }, captions: { status: "passed", cueCount: 1, overflowCount: 0, cueLayoutDigest: digest }, timing: { status: "passed", firstFrameMs: 0, lastFrameMs: 15000, audioSyncMaxDriftMs: 0, timelineDigest: digest }, safeAreas: { status: "passed", violationCount: 0, layoutDigest: digest, preset: "short-form-v1" } }, intentId: "intent", operationId: "operation", verifier: { kind: "qualified_internal", adapterId: "verifier", adapterVersion: "1", qualificationDigest: digest }, reportDigest: digest, verifiedAt: "2026-01-01T00:00:00.000Z", digest } }
    const revision = { workspaceId: "workspace-a", id: "content-a", title: "Launch", revision: 2, state: "active", payload: { format: "slideshow", formatDefinition: { id: "content-format:slideshow", revision: 1, digest }, contentLanguage: "ar", renderProofStatus: "passed", candidates: [qualified] } }
    const revisionDigest = dashboardContentRevisionDigest(revision)
    expect(hasQualifiedDashboardRenderProof(revision.payload)).toBe(true)
    expect(isAcceptedDashboardContent(revision, [])).toBe(false)
    expect(isAcceptedDashboardContent(revision, [{ workspaceId: "workspace-a", status: "accepted", body: { purpose: "content_acceptance", resourceKind: "content_piece_revision", resourceId: "content-a", revisionDigest, progress: { status: "accepted" } } }])).toBe(true)
    expect(isAcceptedDashboardContent(revision, [{ workspaceId: "workspace-b", status: "accepted", body: { purpose: "content_acceptance", resourceKind: "content_piece_revision", resourceId: "content-a", revisionDigest, progress: { status: "accepted" } } }])).toBe(false)
    expect(isAcceptedDashboardContent(revision, [{ workspaceId: "workspace-a", status: "accepted", body: { purpose: "content_acceptance", resourceKind: "content_piece_revision", resourceId: "content-a", revisionDigest: `sha256:${"e".repeat(64)}`, progress: { status: "accepted" } } }])).toBe(false)
    expect(isAcceptedDashboardContent(revision, [{ workspaceId: "workspace-a", status: "accepted", body: { purpose: "content_acceptance", resourceKind: "content_piece_revision", resourceId: "content-a", revisionDigest, progress: { status: "rejected" } } }])).toBe(false)
    expect(isAcceptedDashboardContent({ ...revision, revision: 3 }, [{ workspaceId: "workspace-a", status: "accepted", body: { purpose: "content_acceptance", resourceKind: "content_piece_revision", resourceId: "content-a", revisionDigest, progress: { status: "accepted" } } }])).toBe(false)
  })

  it("routes each durable review kind to its authoritative surface", () => {
    expect(dashboardReviewHref("blitz_item", "b1")).toBe("/blitz")
    expect(dashboardReviewHref("creator_persona", "p 1")).toBe("/influencers?persona=p%201")
    expect(dashboardReviewHref("channel_onboarding_order", "o1")).toBe("/channels/onboarding?order=o1")
  })
})
