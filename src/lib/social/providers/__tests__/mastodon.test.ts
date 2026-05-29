import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { clearRegistry } from "@/lib/social/provider-registry"

const mockFetch = vi.fn()
vi.stubGlobal("fetch", mockFetch)

function mockFetchOk(body: unknown) {
  return {
    ok: true,
    status: 200,
    json: vi.fn().mockResolvedValue(body),
    text: vi.fn().mockResolvedValue(JSON.stringify(body)),
  }
}

function mockFetchError(status: number, body = "error") {
  return {
    ok: false,
    status,
    json: vi.fn().mockResolvedValue({}),
    text: vi.fn().mockResolvedValue(body),
  }
}

import { mastodonProvider } from "@/lib/social/providers/mastodon"

describe("mastodonProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearRegistry()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe("capabilities", () => {
    it("exposes correct metadata", () => {
      expect(mastodonProvider.identifier).toBe("mastodon")
      expect(mastodonProvider.maxContentLength).toBe(500)
      expect(mastodonProvider.supportsImages).toBe(true)
      expect(mastodonProvider.supportsVideo).toBe(false)
      expect(mastodonProvider.maxImages).toBe(4)
      expect(mastodonProvider.requiresPageSelection).toBe(false)
    })
  })

  describe("authenticate", () => {
    it("exchanges code for token and returns profile", async () => {
      mockFetch
        .mockResolvedValueOnce(mockFetchOk({ access_token: "mastodon-access-token", token_type: "Bearer" }))
        .mockResolvedValueOnce(mockFetchOk({ id: "12345", username: "alice", display_name: "Alice", avatar: "https://mastodon.social/avatars/alice.png", acct: "alice" }))

      const result = await mastodonProvider.authenticate({
        code: "oauth-code",
        state: "state",
        redirectUri: "https://app.example.com/callback",
        codeVerifier: JSON.stringify({ instanceUrl: "https://mastodon.social", clientId: "client-id", clientSecret: "client-secret" }),
      })

      expect(result.platformUserId).toBe("12345")
      expect(result.displayName).toBe("Alice")
      expect(result.username).toBe("alice")
      expect(result.requiresPageSelection).toBe(false)
      // Token should be a JSON bundle containing instanceUrl
      const tokenBundle = JSON.parse(result.accessToken)
      expect(tokenBundle.accessToken).toBe("mastodon-access-token")
      expect(tokenBundle.instanceUrl).toBe("https://mastodon.social")
    })

    it("throws on token exchange failure", async () => {
      mockFetch.mockResolvedValueOnce(mockFetchError(401, "invalid_grant"))
      await expect(mastodonProvider.authenticate({
        code: "bad-code",
        state: "state",
        redirectUri: "https://app.example.com/callback",
        codeVerifier: JSON.stringify({ instanceUrl: "https://mastodon.social", clientId: "client-id", clientSecret: "client-secret" }),
      })).rejects.toThrow("Mastodon token exchange failed")
    })
  })

  describe("refreshToken", () => {
    it("returns same token since mastodon tokens do not expire", async () => {
      const bundle = JSON.stringify({ accessToken: "mastodon-access-token", instanceUrl: "https://mastodon.social" })
      const result = await mastodonProvider.refreshToken(bundle)
      expect(result.accessToken).toBe("mastodon-access-token")
    })
  })

  describe("post", () => {
    it("creates a text-only status", async () => {
      mockFetch.mockResolvedValueOnce(mockFetchOk({ id: "109876543", url: "https://mastodon.social/@alice/109876543" }))

      const results = await mastodonProvider.post(
        "12345",
        JSON.stringify({ accessToken: "mastodon-access-token", instanceUrl: "https://mastodon.social" }),
        [{ postId: "spost_1", content: "Hello from node banana" }],
      )

      expect(results).toHaveLength(1)
      expect(results[0].status).toBe("published")
      expect(results[0].platformPostId).toBe("109876543")
    })

    it("creates a status with visibility and content warning", async () => {
      mockFetch.mockResolvedValueOnce(mockFetchOk({ id: "109876544", url: "https://mastodon.social/@alice/109876544" }))

      await mastodonProvider.post(
        "12345",
        JSON.stringify({ accessToken: "mastodon-access-token", instanceUrl: "https://mastodon.social" }),
        [{ postId: "spost_2", content: "Spoiler content", platformSettings: { visibility: "unlisted", contentWarning: "TV show spoiler" } }],
      )

      const body = JSON.parse(mockFetch.mock.calls[0][1].body as string)
      expect(body.visibility).toBe("unlisted")
      expect(body.spoiler_text).toBe("TV show spoiler")
    })

    it("defaults visibility to public", async () => {
      mockFetch.mockResolvedValueOnce(mockFetchOk({ id: "109876545", url: "https://mastodon.social/@alice/109876545" }))

      await mastodonProvider.post(
        "12345",
        JSON.stringify({ accessToken: "mastodon-access-token", instanceUrl: "https://mastodon.social" }),
        [{ postId: "spost_3", content: "No settings" }],
      )

      const body = JSON.parse(mockFetch.mock.calls[0][1].body as string)
      expect(body.visibility).toBe("public")
    })
  })

  describe("classifyError", () => {
    it("classifies 401 as refresh-token", () => {
      expect(mastodonProvider.classifyError(new Error("401 Unauthorized")).type).toBe("refresh-token")
    })
    it("classifies validation errors as bad-body", () => {
      expect(mastodonProvider.classifyError(new Error("422 Unprocessable: content too long")).type).toBe("bad-body")
    })
    it("classifies rate limit as retry", () => {
      expect(mastodonProvider.classifyError(new Error("429 Rate limit")).type).toBe("retry")
    })
  })
})
