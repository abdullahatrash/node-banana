/**
 * Facebook provider tests.
 *
 * All Graph API calls are mocked via vi.stubGlobal("fetch", ...) so no
 * network access is required.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SocialProviderAdapter } from "@/lib/social/provider-interface";
import { MetaApiError } from "@/lib/social/providers/meta-common";

/**
 * Build a production-realistic `MetaApiError` exactly as the Facebook provider
 * throws one: the human-readable Graph message on `.message`, the numeric code
 * on `.code`, and the full platform error body on `.rawBody`. The numeric code
 * is NEVER folded into `.message` — that is the whole point of the shape.
 */
function metaError(message: string, code: number): MetaApiError {
  return new MetaApiError(
    message,
    code,
    JSON.stringify({
      error: { message, type: "OAuthException", code, fbtrace_id: "AbCdEfGhIjK" },
    }),
  );
}

// ---------------------------------------------------------------------------
// Environment stubs
// ---------------------------------------------------------------------------
beforeEach(() => {
  vi.stubEnv("META_APP_ID", "test-app-id");
  vi.stubEnv("META_APP_SECRET", "test-app-secret");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockFetchSequence(
  responses: Array<Record<string, unknown>>,
): ReturnType<typeof vi.fn> {
  let callIndex = 0;
  const mockFetch = vi.fn().mockImplementation(async () => {
    const body = responses[callIndex] ?? responses[responses.length - 1];
    callIndex++;
    return {
      json: async () => body,
      ok: !("error" in body),
    };
  });
  vi.stubGlobal("fetch", mockFetch);
  return mockFetch;
}

async function loadProvider(): Promise<SocialProviderAdapter> {
  const mod = await import("@/lib/social/providers/facebook");
  return mod.facebookProvider;
}

// ---------------------------------------------------------------------------
// generateAuthUrl
// ---------------------------------------------------------------------------

describe("facebookProvider.generateAuthUrl", () => {
  it("returns a valid Facebook OAuth dialog URL", async () => {
    const provider = await loadProvider();
    const result = await provider.generateAuthUrl(
      "https://example.com/callback/facebook",
    );

    expect(result.url).toContain("https://www.facebook.com/v20.0/dialog/oauth");
    expect(result.url).toContain("client_id=test-app-id");
    expect(result.url).toContain(
      encodeURIComponent("https://example.com/callback/facebook"),
    );
    expect(result.state).toBeTruthy();
    expect(result.state.length).toBeGreaterThanOrEqual(8);
  });

  it("includes all required Facebook page-management scopes", async () => {
    const provider = await loadProvider();
    const { url } = await provider.generateAuthUrl("https://example.com/cb");

    const expectedScopes = [
      "pages_show_list",
      "business_management",
      "pages_manage_posts",
      "pages_manage_engagement",
      "pages_read_engagement",
      "read_insights",
    ];

    for (const scope of expectedScopes) {
      expect(url).toContain(scope);
    }
  });

  it("does not include Instagram-specific scopes", async () => {
    const provider = await loadProvider();
    const { url } = await provider.generateAuthUrl("https://example.com/cb");

    expect(url).not.toContain("instagram_content_publish");
    expect(url).not.toContain("instagram_basic");
  });

  it("generates a unique state on each call", async () => {
    const provider = await loadProvider();
    const a = await provider.generateAuthUrl("https://example.com/cb");
    const b = await provider.generateAuthUrl("https://example.com/cb");
    expect(a.state).not.toBe(b.state);
  });

  it("throws when META_APP_ID is missing", async () => {
    vi.stubEnv("META_APP_ID", "");
    vi.resetModules();
    const provider = await loadProvider();
    await expect(
      provider.generateAuthUrl("https://example.com/cb"),
    ).rejects.toThrow("META_APP_ID");
  });
});

// ---------------------------------------------------------------------------
// authenticate
// ---------------------------------------------------------------------------

describe("facebookProvider.authenticate", () => {
  it("exchanges code for long-lived token and returns profile data", async () => {
    mockFetchSequence([
      // 1. Short-lived token
      { access_token: "short-token", token_type: "bearer" },
      // 2. Long-lived token
      { access_token: "long-token", token_type: "bearer", expires_in: 5097600 },
      // 3. Permission check
      {
        data: [
          { permission: "pages_show_list", status: "granted" },
          { permission: "business_management", status: "granted" },
          { permission: "pages_manage_posts", status: "granted" },
          { permission: "pages_manage_engagement", status: "granted" },
          { permission: "pages_read_engagement", status: "granted" },
          { permission: "read_insights", status: "granted" },
        ],
      },
      // 4. /me?fields=id,name,picture
      {
        id: "fb-user-123",
        name: "Test Page Admin",
        picture: { data: { url: "https://example.com/avatar.jpg" } },
      },
    ]);

    const provider = await loadProvider();
    const result = await provider.authenticate({
      code: "auth-code",
      state: "oauth-state",
      redirectUri: "https://example.com/callback",
    });

    expect(result.platformUserId).toBe("fb-user-123");
    expect(result.accessToken).toBe("long-token");
    expect(result.displayName).toBe("Test Page Admin");
    expect(result.avatarUrl).toBe("https://example.com/avatar.jpg");
    expect(result.requiresPageSelection).toBe(true);
    expect(result.expiresIn).toBe(5097600);
  });

  it("throws when a required permission is missing", async () => {
    mockFetchSequence([
      { access_token: "short-token", token_type: "bearer" },
      { access_token: "long-token", token_type: "bearer", expires_in: 5097600 },
      // Missing pages_manage_posts
      {
        data: [
          { permission: "pages_show_list", status: "granted" },
          { permission: "business_management", status: "granted" },
        ],
      },
    ]);

    const provider = await loadProvider();
    await expect(
      provider.authenticate({
        code: "auth-code",
        state: "oauth-state",
        redirectUri: "https://example.com/cb",
      }),
    ).rejects.toThrow(/pages_manage_posts/);
  });
});

// ---------------------------------------------------------------------------
// fetchPageInformation
// ---------------------------------------------------------------------------

describe("facebookProvider.fetchPageInformation", () => {
  it("returns list of pages with access tokens", async () => {
    mockFetchSequence([
      // /me/accounts
      {
        data: [
          {
            id: "page-1",
            name: "My Business Page",
            username: "mybizpage",
            access_token: "page-token-1",
            picture: { data: { url: "https://example.com/page.jpg" } },
          },
        ],
        paging: {},
      },
      // /me/businesses
      { data: [], paging: {} },
    ]);

    const provider = await loadProvider();
    const pages = await provider.fetchPageInformation!("user-token");

    expect(pages).toHaveLength(1);
    expect(pages[0].id).toBe("page-1");
    expect(pages[0].name).toBe("My Business Page");
    expect(pages[0].username).toBe("mybizpage");
    expect(pages[0].accessToken).toBe("page-token-1");
    expect(pages[0].picture).toBe("https://example.com/page.jpg");
  });

  it("returns empty list when user has no pages", async () => {
    mockFetchSequence([
      { data: [], paging: {} },
      { data: [], paging: {} },
    ]);

    const provider = await loadProvider();
    const pages = await provider.fetchPageInformation!("user-token");
    expect(pages).toHaveLength(0);
  });

  it("deduplicates pages seen in both /me/accounts and Business Manager", async () => {
    mockFetchSequence([
      // /me/accounts
      {
        data: [
          {
            id: "page-1",
            name: "Page 1",
            access_token: "tok-1",
            picture: { data: { url: "" } },
          },
        ],
        paging: {},
      },
      // /me/businesses
      {
        data: [{ id: "biz-1" }],
        paging: {},
      },
      // owned_pages — returns the same page-1 again
      {
        data: [
          {
            id: "page-1",
            name: "Page 1 duplicate",
            access_token: "tok-1",
            picture: { data: { url: "" } },
          },
        ],
        paging: {},
      },
      // client_pages — empty
      { data: [], paging: {} },
    ]);

    const provider = await loadProvider();
    const pages = await provider.fetchPageInformation!("user-token");

    // Should deduplicate by page id
    const uniqueIds = new Set(pages.map((p) => p.id));
    expect(uniqueIds.size).toBe(pages.length);
    expect(pages.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// post — text only
// ---------------------------------------------------------------------------

describe("facebookProvider.post — text only", () => {
  it("publishes a text-only post to the page feed", async () => {
    mockFetchSequence([
      // /feed response
      {
        id: "post-123",
        permalink_url: "https://www.facebook.com/mybizpage/posts/post-123",
      },
    ]);

    const provider = await loadProvider();
    const results = await provider.post("page-id", "page-access-token", [
      {
        postId: "our-post-1",
        content: "Hello Facebook!",
      },
    ]);

    expect(results).toHaveLength(1);
    expect(results[0].postId).toBe("our-post-1");
    expect(results[0].platformPostId).toBe("post-123");
    expect(results[0].platformPostUrl).toBe(
      "https://www.facebook.com/mybizpage/posts/post-123",
    );
    expect(results[0].status).toBe("published");
  });
});

// ---------------------------------------------------------------------------
// post — single photo
// ---------------------------------------------------------------------------

describe("facebookProvider.post — single photo", () => {
  it("uploads photo as unpublished then publishes feed post with attached_media", async () => {
    mockFetchSequence([
      // Upload photo (unpublished)
      { id: "photo-456" },
      // Feed post
      {
        id: "feed-post-789",
        permalink_url: "https://www.facebook.com/mybizpage/posts/789",
      },
    ]);

    const provider = await loadProvider();
    const results = await provider.post("page-id", "page-access-token", [
      {
        postId: "our-photo-post",
        content: "Look at this!",
        media: [{ type: "image", url: "https://cdn.example.com/photo.jpg" }],
      },
    ]);

    expect(results[0].platformPostId).toBe("feed-post-789");
    expect(results[0].status).toBe("published");
  });
});

// ---------------------------------------------------------------------------
// post — multi-photo
// ---------------------------------------------------------------------------

describe("facebookProvider.post — multi-photo", () => {
  it("uploads each photo separately then creates a feed post with all attached", async () => {
    mockFetchSequence([
      // Upload photo 1
      { id: "photo-1" },
      // Upload photo 2
      { id: "photo-2" },
      // Upload photo 3
      { id: "photo-3" },
      // Feed post
      {
        id: "multi-post",
        permalink_url: "https://www.facebook.com/page/posts/multi-post",
      },
    ]);

    const provider = await loadProvider();
    const results = await provider.post("page-id", "page-access-token", [
      {
        postId: "our-multi-post",
        content: "Multi-photo post",
        media: [
          { type: "image", url: "https://cdn.example.com/1.jpg" },
          { type: "image", url: "https://cdn.example.com/2.jpg" },
          { type: "image", url: "https://cdn.example.com/3.jpg" },
        ],
      },
    ]);

    expect(results[0].platformPostId).toBe("multi-post");

    // Verify each photo was uploaded
    const mockFetch = vi.mocked(global.fetch);
    const photoCalls = mockFetch.mock.calls.filter((call) =>
      String(call[0]).includes("/photos"),
    );
    expect(photoCalls).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// post — video
// ---------------------------------------------------------------------------

describe("facebookProvider.post — video", () => {
  it("posts video to /{page-id}/videos", async () => {
    mockFetchSequence([
      // /videos response
      {
        id: "video-id-999",
        permalink_url: undefined, // Facebook doesn't always return this
      },
    ]);

    const provider = await loadProvider();
    const results = await provider.post("page-id", "page-access-token", [
      {
        postId: "video-post",
        content: "Check out this video",
        media: [{ type: "video", url: "https://cdn.example.com/video.mp4" }],
      },
    ]);

    expect(results[0].platformPostId).toBe("video-id-999");
    // Falls back to reel URL when permalink_url not returned
    expect(results[0].platformPostUrl).toContain("video-id-999");
    expect(results[0].status).toBe("published");

    // Verify it used /videos endpoint
    const mockFetch = vi.mocked(global.fetch);
    const videoCall = mockFetch.mock.calls.find((call) =>
      String(call[0]).includes("/videos"),
    );
    expect(videoCall).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// post — link attachment
// ---------------------------------------------------------------------------

describe("facebookProvider.post — link attachment", () => {
  it("includes link from platformSettings in feed body", async () => {
    mockFetchSequence([
      {
        id: "link-post",
        permalink_url: "https://www.facebook.com/page/posts/link-post",
      },
    ]);

    const provider = await loadProvider();
    await provider.post("page-id", "page-access-token", [
      {
        postId: "link-post",
        content: "Check this out",
        platformSettings: { link: "https://example.com/article" },
      },
    ]);

    const mockFetch = vi.mocked(global.fetch);
    const feedCall = mockFetch.mock.calls.find((call) =>
      String(call[0]).includes("/feed"),
    );
    expect(feedCall).toBeDefined();
    const body = JSON.parse(feedCall?.[1]?.body as string);
    expect(body.link).toBe("https://example.com/article");
  });
});

// ---------------------------------------------------------------------------
// post — empty request
// ---------------------------------------------------------------------------

describe("facebookProvider.post — empty request array", () => {
  it("returns empty results for empty request array", async () => {
    const provider = await loadProvider();
    const results = await provider.post("page-id", "token", []);
    expect(results).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// classifyError
// ---------------------------------------------------------------------------

describe("facebookProvider.classifyError", () => {
  it("classifies Error validating access token as refresh-token", async () => {
    const provider = await loadProvider();
    const result = provider.classifyError(
      new Error("Error validating access token: session has been invalidated"),
    );
    expect(result.type).toBe("refresh-token");
  });

  it("classifies 490 error as refresh-token", async () => {
    const provider = await loadProvider();
    const result = provider.classifyError(
      metaError("Token expired", 490),
    );
    expect(result.type).toBe("refresh-token");
  });

  it("classifies REVOKED_ACCESS_TOKEN as refresh-token", async () => {
    const provider = await loadProvider();
    const result = provider.classifyError("REVOKED_ACCESS_TOKEN has occurred");
    expect(result.type).toBe("refresh-token");
  });

  it("classifies 1366046 (photo too large) as bad-body", async () => {
    const provider = await loadProvider();
    const result = provider.classifyError(
      metaError("Photo too large", 1366046),
    );
    expect(result.type).toBe("bad-body");
    expect(result.message).toContain("4 MB");
  });

  it("classifies 1390008 (posting too fast) as bad-body", async () => {
    const provider = await loadProvider();
    const result = provider.classifyError(
      metaError("Posting too fast", 1390008),
    );
    expect(result.type).toBe("bad-body");
    expect(result.message).toContain("too fast");
  });

  it("classifies 1346003 (abusive content) as bad-body", async () => {
    const provider = await loadProvider();
    const result = provider.classifyError(
      metaError("Abusive content", 1346003),
    );
    expect(result.type).toBe("bad-body");
    expect(result.message).toContain("abusive");
  });

  it("classifies 1609008 (cannot post FB links) as bad-body", async () => {
    const provider = await loadProvider();
    const result = provider.classifyError(
      metaError("Cannot post Facebook.com links", 1609008),
    );
    expect(result.type).toBe("bad-body");
  });

  it("classifies temporary unavailability (1363047) as retry", async () => {
    const provider = await loadProvider();
    const result = provider.classifyError(
      metaError("Service temporarily unavailable", 1363047),
    );
    expect(result.type).toBe("retry");
  });

  it("classifies 1404078 (page authorization) as refresh-token", async () => {
    const provider = await loadProvider();
    const result = provider.classifyError(
      metaError("Page publishing authorization required", 1404078),
    );
    expect(result.type).toBe("refresh-token");
  });

  it("classifies unknown error as retry", async () => {
    const provider = await loadProvider();
    const result = provider.classifyError(new Error("Something unusual happened"));
    expect(result.type).toBe("retry");
    expect(result.message).toContain("Something unusual happened");
  });

  it("classifies non-Error objects as retry", async () => {
    const provider = await loadProvider();
    const result = provider.classifyError({ weird: "object" });
    expect(result.type).toBe("retry");
  });

  it("handles string errors", async () => {
    const provider = await loadProvider();
    const result = provider.classifyError("1404102 community standards");
    expect(result.type).toBe("bad-body");
  });
});

// ---------------------------------------------------------------------------
// getCapabilities
// ---------------------------------------------------------------------------

describe("facebookProvider.getCapabilities", () => {
  it("returns correct capabilities", async () => {
    const provider = await loadProvider();
    const caps = provider.getCapabilities();
    expect(caps.identifier).toBe("facebook");
    expect(caps.displayName).toBe("Facebook");
    expect(caps.maxContentLength).toBe(63206);
    expect(caps.supportsImages).toBe(true);
    expect(caps.supportsVideo).toBe(true);
    expect(caps.supportsCarousel).toBe(true);
    expect(caps.requiresPageSelection).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Provider interface conformance
// ---------------------------------------------------------------------------

describe("facebookProvider interface conformance", () => {
  it("has all required interface properties", async () => {
    const provider = await loadProvider();
    expect(provider.identifier).toBe("facebook");
    expect(provider.maxImages).toBe(10);
    expect(provider.maxConcurrentJobs).toBeGreaterThan(0);
    expect(typeof provider.generateAuthUrl).toBe("function");
    expect(typeof provider.authenticate).toBe("function");
    expect(typeof provider.refreshToken).toBe("function");
    expect(typeof provider.post).toBe("function");
    expect(typeof provider.classifyError).toBe("function");
    expect(typeof provider.fetchPageInformation).toBe("function");
    expect(typeof provider.getCapabilities).toBe("function");
  });
});
