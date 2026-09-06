import { describe, expect, it } from "vitest"
import { projectProductCopilotContext } from "../copilot-context-projection"
import type { DashboardReadModel } from "../dashboard"

const generatedAt = new Date("2026-09-04T12:00:00.000Z")
const dashboard = {
  nextAction: { key: "content", reason: "content_missing", href: "/blitz" },
  sourceEnvelopes: [
    { source: "brand", status: "ready", count: 1, updatedAt: new Date("2026-09-04T11:00:00.000Z"), href: "/brand" },
    { source: "media", status: "missing", count: 0, updatedAt: null, href: "/library?tab=media" },
    { source: "channels", status: "attention", count: 2, updatedAt: new Date("2026-09-01T11:00:00.000Z"), href: "/channels" },
  ],
} satisfies Pick<DashboardReadModel, "nextAction" | "sourceEnvelopes">

describe("product Copilot context projection", () => {
  it("pins the accepted Brand revision, authoritative language policy, exact non-effect capabilities, and evidence freshness", () => {
    const context = projectProductCopilotContext({ dashboard, generatedAt, brand: { profileId: "brand_1", revision: 4, digest: `sha256:${"a".repeat(64)}`, acceptedAt: new Date("2026-09-02T00:00:00.000Z"), contentLanguage: "ar", arabicVariety: null } })
    expect(context.brand).toMatchObject({ profileId: "brand_1", revision: 4 })
    expect(context.language).toEqual({ contentLanguage: "ar", arabicVariety: null, basis: "active_brand_profile" })
    expect(context.capabilities).toEqual(["explain_workspace_readiness", "navigate_recommended_action"])
    expect(context.evidence.map(({ freshness }) => freshness)).toEqual(["current", "unknown", "stale"])
  })

  it("preserves a pinned non-MSA variety when an authoritative source provides one", () => {
    const context = projectProductCopilotContext({ dashboard, generatedAt, brand: { profileId: "brand_1", revision: 4, digest: `sha256:${"a".repeat(64)}`, acceptedAt: new Date("2026-09-02T00:00:00.000Z"), contentLanguage: "ar", arabicVariety: "gulf" } })
    expect(context.language.arabicVariety).toBe("gulf")
  })

  it("states unavailable language and Brand evidence instead of inventing context", () => {
    const context = projectProductCopilotContext({ dashboard, generatedAt, brand: null })
    expect(context.brand).toBeNull()
    expect(context.language).toEqual({ contentLanguage: null, arabicVariety: null, basis: "unavailable" })
  })
})
