import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const mockHasVerifiedWebsiteOrigin = vi.fn()
const mockCollectWebsite = vi.fn()

vi.mock("server-only", () => ({}))
vi.mock("@/lib/db", () => ({ isDatabaseConfigured: vi.fn(() => true) }))
vi.mock("@/lib/product-surfaces/analytics-observation-repository", () => ({ PRODUCTION_ANALYTICS_OBSERVATIONS: { hasVerifiedWebsiteOrigin: (...args: unknown[]) => mockHasVerifiedWebsiteOrigin(...args) } }))
vi.mock("@/lib/product-surfaces/analytics-observation-service", () => ({ AnalyticsObservationService: class { collectWebsite(...args: unknown[]) { return mockCollectWebsite(...args) } } }))

import { OPTIONS, POST } from "../route"

const request = (method: "OPTIONS" | "POST", body?: unknown, origin = "https://example.com") => new NextRequest("https://app.tasmeem.ai/api/product-analytics/collect", { method, headers: { origin, "content-type": "application/json", "x-tasmeemai-source-key": "web_secret_key_12345678901234567890" }, body: body === undefined ? undefined : JSON.stringify(body) })

describe("website analytics collector", () => {
  beforeEach(() => { vi.clearAllMocks() })

  it("only grants CORS preflight to a server-verified Website origin", async () => {
    mockHasVerifiedWebsiteOrigin.mockResolvedValueOnce(false).mockResolvedValueOnce(true)
    expect((await OPTIONS(request("OPTIONS", undefined, "https://evil.example"))).status).toBe(403)
    const allowed = await OPTIONS(request("OPTIONS"))
    expect(allowed.status).toBe(204)
    expect(allowed.headers.get("access-control-allow-origin")).toBe("https://example.com")
    expect(allowed.headers.get("access-control-allow-headers")).toContain("x-tasmeemai-source-key")
  })

  it("keeps the opaque key out of the response and returns only receipt state", async () => {
    mockCollectWebsite.mockResolvedValue({ created: true, observation: { windowEndedAt: new Date("2026-09-04T11:00:00.000Z"), workspaceId: "secret_workspace", sourceId: "secret_source" } })
    const event = { eventId: "event.website.0001", eventType: "page_view", occurredAt: "2026-09-04T10:59:00.000Z", scope: { region: "mena", consentRevision: "consent-v2", consentPurpose: "analytics", retentionUntil: "2026-10-04T00:00:00.000Z", campaignTag: null, contentType: "page", platform: "website", accountRefDigest: null, publishingState: "not_applicable" }, signature: `hmac-sha256:${"a".repeat(64)}` }
    const response = await POST(request("POST", event))
    const text = await response.text()
    expect(response.status).toBe(202)
    expect(response.headers.get("access-control-allow-origin")).toBe("https://example.com")
    expect(text).not.toContain("secret_workspace")
    expect(text).not.toContain("secret_source")
    expect(text).not.toContain("web_secret")
    expect(JSON.parse(text)).toEqual({ success: true, accepted: true, duplicate: false, observedAt: "2026-09-04T11:00:00.000Z" })
    expect(mockCollectWebsite).toHaveBeenCalledWith(event, { origin: "https://example.com", sourceKey: "web_secret_key_12345678901234567890" })
  })

  it("fails closed before collection when origin or key is absent", async () => {
    const response = await POST(new NextRequest("https://app.tasmeem.ai/api/product-analytics/collect", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }))
    expect(response.status).toBe(403)
    expect(mockCollectWebsite).not.toHaveBeenCalled()
  })
})
