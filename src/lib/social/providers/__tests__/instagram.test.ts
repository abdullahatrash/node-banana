/**
 * Instagram provider tests.
 *
 * All Graph API calls are mocked via vi.stubGlobal("fetch", ...) so no
 * network access is required and we can exercise every branch in isolation.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SocialProviderAdapter } from "@/lib/social/provider-interface";

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
  const mod = await import("@/lib/social/providers/instagram");
  return mod.instagramProvider;
}

// ---------------------------------------------------------------------------
// generateAuthUrl
// ---------------------------------------------------------------------------

describe("instagramProvider.generateAuthUrl", () => {
  it("returns a valid Facebook OAuth dialog URL", async () => {
    const provider = await loadProvider();
    const result = await provider.generateAuthUrl(
      "https://example.com/callback/instagram",
    );

    expect(result.url).toContain("https://www.facebook.com/v20.0/dialog/oauth");
    expect(result.url).toContain("client_id=test-app-id");
    expect(result.url).toContain(encodeURIComponent("https://example.com/callback/instagram"));
    expect(result.url).toContain("instagram_basic");
    expect(result.url).toContain("instagram_content_publish");
    expect(result.state).toBeTruthy();
    expect(result.state.length).toBeGreaterThanOrEqual(8);
  });

  it("includes all required Instagram scopes", async () => {
    const provider = await loadProvider();
    const { url } = await provider.generateAuthUrl("https://example.com/cb");

    const expectedScopes = [
      "instagram_basic",
      "pages_show_list",
      "pages_read_engagement",
      "business_management",
      "instagram_content_publish",
      "instagram_manage_comments",
      "instagram_manage_insights",
    ];

    for (const scope of expectedScopes) {
      expect(url).toContain(scope);
    }
  });

  it("generates a unique state on each call", async () => {
    const provider = await loadProvider();
    const a = await provider.generateAuthUrl("https://example.com/cb");
    const b = await provider.generateAuthUrl("https://example.com/cb");
    expect(a.state).not.toBe(b.state);
  });

  it("throws when META_APP_ID is missing", async () => {
    vi.stubEnv("META_APP_ID", "");
    // Re-import so the env variable is re-read
    vi.resetModules();
    const provider = await loadProvider();
    await expect(
      provider.generateAuthUrl("https://example.com/cb"),
    ).rejects.toThrow("META_APP_ID");
  });
});

// ---------------------------------------------------------------------------
// authenticate (token exchange)
// ---------------------------------------------------------------------------

describe("instagramProvider.authenticate", () => {
  it("exchanges code for long-lived token and returns profile data", async () => {
    mockFetchSequence([
      // 1. Short-lived token exchange
      { access_token: "short-token", token_type: "bearer" },
      // 2. Long-lived token exchange
      { access_token: "long-token", token_type: "bearer", expires_in: 5097600 },
      // 3. Permission check
      {
        data: [
          { permission: "instagram_basic", status: "granted" },
          { permission: "pages_show_list", status: "granted" },
          { permission: "pages_read_engagement", status: "granted" },
          { permission: "business_management", status: "granted" },
          { permission: "instagram_content_publish", status: "granted" },
          { permission: "instagram_manage_comments", status: "granted" },
          { permission: "instagram_manage_insights", status: "granted" },
        ],
      },
      // 4. /me?fields=id,name,picture
      {
        id: "123456",
        name: "Test User",
        picture: { data: { url: "https://example.com/pic.jpg" } },
      },
    ]);

    const provider = await loadProvider();
    const result = await provider.authenticate({
      code: "auth-code",
      codeVerifier: "https://example.com/callback",
    });

    expect(result.platformUserId).toBe("123456");
    expect(result.accessToken).toBe("long-token");
    expect(result.displayName).toBe("Test User");
    expect(result.avatarUrl).toBe("https://example.com/pic.jpg");
    expect(result.requiresPageSelection).toBe(true);
    expect(result.expiresIn).toBe(5097600);
  });

  it("throws when a required permission is missing", async () => {
    mockFetchSequence([
      { access_token: "short-token", token_type: "bearer" },
      { access_token: "long-token", token_type: "bearer", expires_in: 5097600 },
      // Missing instagram_content_publish
      {
        data: [
          { permission: "instagram_basic", status: "granted" },
          { permission: "pages_show_list", status: "granted" },
          { permission: "pages_read_engagement", status: "granted" },
          { permission: "business_management", status: "granted" },
        ],
      },
    ]);

    const provider = await loadProvider();
    await expect(
      provider.authenticate({ code: "auth-code", codeVerifier: "https://example.com/cb" }),
    ).rejects.toThrow(/instagram_content_publish/);
  });
});

// ---------------------------------------------------------------------------
// fetchPageInformation
// ---------------------------------------------------------------------------

describe("instagramProvider.fetchPageInformation", () => {
  it("returns list of Instagram Business accounts linked to FB Pages", async () => {
    mockFetchSequence([
      // /me/accounts
      {
        data: [
          {
            id: "fb-page-1",
            name: "My FB Page",
            instagram_business_account: { id: "ig-biz-1" },
          },
        ],
        paging: {},
      },
      // /me/businesses
      { data: [], paging: {} },
      // IG user details for ig-biz-1
      {
        id: "ig-biz-1",
        name: "My IG Account",
        username: "myigaccount",
        profile_picture_url: "https://example.com/ig.jpg",
      },
      // Page access token
      { access_token: "page-access-token" },
    ]);

    const provider = await loadProvider();
    const pages = await provider.fetchPageInformation!("user-token");

    expect(pages).toHaveLength(1);
    expect(pages[0].id).toBe("ig-biz-1");
    expect(pages[0].name).toBe("My IG Account");
    expect(pages[0].username).toBe("myigaccount");
    expect(pages[0].accessToken).toBe("page-access-token");
  });

  it("returns empty list when no pages have IG business accounts", async () => {
    mockFetchSequence([
      // /me/accounts — page without IG business account
      {
        data: [{ id: "fb-page-no-ig", name: "Personal Page" }],
        paging: {},
      },
      // /me/businesses
      { data: [], paging: {} },
    ]);

    const provider = await loadProvider();
    const pages = await provider.fetchPageInformation!("user-token");
    expect(pages).toHaveLength(0);
  });

  it("handles pagination across multiple pages", async () => {
    let callCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (url: string) => {
        callCount++;
        if (callCount === 1) {
          // First /me/accounts page — has next
          return {
            json: async () => ({
              data: [
                {
                  id: "fb-page-1",
                  name: "Page 1",
                  instagram_business_account: { id: "ig-1" },
                },
              ],
              paging: { next: "https://graph.facebook.com/v20.0/me/accounts?cursor=2" },
            }),
          };
        }
        if (callCount === 2) {
          // Second /me/accounts page — no next
          return {
            json: async () => ({
              data: [
                {
                  id: "fb-page-2",
                  name: "Page 2",
                  instagram_business_account: { id: "ig-2" },
                },
              ],
              paging: {},
            }),
          };
        }
        if (callCount === 3) {
          // /me/businesses
          return { json: async () => ({ data: [], paging: {} }) };
        }
        // IG details + page token for ig-1 and ig-2
        if (url.includes("ig-1")) {
          return {
            json: async () => ({
              id: "ig-1",
              name: "IG Acct 1",
              username: "igacct1",
              profile_picture_url: "",
            }),
          };
        }
        if (url.includes("ig-2")) {
          return {
            json: async () => ({
              id: "ig-2",
              name: "IG Acct 2",
              username: "igacct2",
              profile_picture_url: "",
            }),
          };
        }
        // Page token calls
        return { json: async () => ({ access_token: "page-token" }) };
      }),
    );

    const provider = await loadProvider();
    const pages = await provider.fetchPageInformation!("user-token");
    expect(pages.length).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// post — single image
// ---------------------------------------------------------------------------

describe("instagramProvider.post — single image", () => {
  it("creates container, polls until FINISHED, publishes, and returns permalink", async () => {
    mockFetchSequence([
      // 1. POST /ig-user/media → container
      { id: "container-1" },
      // 2. GET /container-1?fields=status_code → FINISHED
      { status_code: "FINISHED" },
      // 3. POST /ig-user/media_publish → media id
      { id: "media-1" },
      // 4. GET /media-1?fields=permalink
      { permalink: "https://www.instagram.com/p/ABC123/" },
    ]);

    const provider = await loadProvider();
    const results = await provider.post("ig-user-id", "access-token", [
      {
        postId: "our-post-1",
        content: "Hello Instagram!",
        media: [{ type: "image", url: "https://cdn.example.com/photo.jpg" }],
      },
    ]);

    expect(results).toHaveLength(1);
    expect(results[0].postId).toBe("our-post-1");
    expect(results[0].platformPostId).toBe("media-1");
    expect(results[0].platformPostUrl).toBe("https://www.instagram.com/p/ABC123/");
    expect(results[0].status).toBe("published");
  });

  it("polls until FINISHED after IN_PROGRESS states", async () => {
    mockFetchSequence([
      // Container creation
      { id: "container-2" },
      // First poll: IN_PROGRESS
      { status_code: "IN_PROGRESS" },
      // Second poll: FINISHED
      { status_code: "FINISHED" },
      // Publish
      { id: "media-2" },
      // Permalink
      { permalink: "https://www.instagram.com/p/XYZ/" },
    ]);

    // Override setTimeout so the test doesn't actually wait 30 s
    vi.useFakeTimers();
    const provider = await loadProvider();

    const postPromise = provider.post("ig-user-id", "access-token", [
      {
        postId: "post-2",
        content: "Test",
        media: [{ type: "image", url: "https://cdn.example.com/img.jpg" }],
      },
    ]);

    // Advance timers past the 30s poll interval
    await vi.runAllTimersAsync();
    const results = await postPromise;

    expect(results[0].status).toBe("published");
    vi.useRealTimers();
  });

  it("throws when container processing returns ERROR status", async () => {
    mockFetchSequence([
      { id: "container-err" },
      { status_code: "ERROR" },
    ]);

    const provider = await loadProvider();

    await expect(
      provider.post("ig-user-id", "access-token", [
        {
          postId: "post-err",
          content: "Test",
          media: [{ type: "image", url: "https://cdn.example.com/img.jpg" }],
        },
      ]),
    ).rejects.toThrow(/ERROR/);
  });
});

// ---------------------------------------------------------------------------
// post — carousel
// ---------------------------------------------------------------------------

describe("instagramProvider.post — carousel", () => {
  it("creates item containers, polls them, creates carousel container, publishes", async () => {
    mockFetchSequence([
      // Item container 1
      { id: "item-1" },
      // Item container 2
      { id: "item-2" },
      // Poll item-1
      { status_code: "FINISHED" },
      // Poll item-2
      { status_code: "FINISHED" },
      // Carousel container
      { id: "carousel-1" },
      // Poll carousel
      { status_code: "FINISHED" },
      // Publish
      { id: "final-media" },
      // Permalink
      { permalink: "https://www.instagram.com/p/CAROUSEL/" },
    ]);

    const provider = await loadProvider();
    const results = await provider.post("ig-user-id", "access-token", [
      {
        postId: "our-post-carousel",
        content: "Carousel caption",
        media: [
          { type: "image", url: "https://cdn.example.com/img1.jpg" },
          { type: "image", url: "https://cdn.example.com/img2.jpg" },
        ],
      },
    ]);

    expect(results[0].platformPostUrl).toBe("https://www.instagram.com/p/CAROUSEL/");
    expect(results[0].status).toBe("published");
  });
});

// ---------------------------------------------------------------------------
// post — video
// ---------------------------------------------------------------------------

describe("instagramProvider.post — video", () => {
  it("creates a REELS container and publishes", async () => {
    mockFetchSequence([
      // Video container
      { id: "video-container" },
      // Poll
      { status_code: "FINISHED" },
      // Publish
      { id: "video-media" },
      // Permalink
      { permalink: "https://www.instagram.com/reel/XYZ/" },
    ]);

    const provider = await loadProvider();
    const results = await provider.post("ig-user-id", "access-token", [
      {
        postId: "post-video",
        content: "My reel",
        media: [{ type: "video", url: "https://cdn.example.com/video.mp4" }],
      },
    ]);

    expect(results[0].platformPostId).toBe("video-media");
    expect(results[0].status).toBe("published");
  });
});

// ---------------------------------------------------------------------------
// post — no media
// ---------------------------------------------------------------------------

describe("instagramProvider.post — no media", () => {
  it("throws because Instagram requires at least one media item", async () => {
    const provider = await loadProvider();
    await expect(
      provider.post("ig-user-id", "access-token", [
        { postId: "post-no-media", content: "Text only" },
      ]),
    ).rejects.toThrow(/at least one image or video/i);
  });
});

// ---------------------------------------------------------------------------
// classifyError
// ---------------------------------------------------------------------------

describe("instagramProvider.classifyError", () => {
  it("classifies REVOKED_ACCESS_TOKEN as refresh-token", async () => {
    const provider = await loadProvider();
    const result = provider.classifyError(
      new Error('{"error":{"message":"REVOKED_ACCESS_TOKEN"}}'),
    );
    expect(result.type).toBe("refresh-token");
  });

  it("classifies unknown error as retry", async () => {
    const provider = await loadProvider();
    const result = provider.classifyError(new Error("Something went wrong"));
    expect(result.type).toBe("retry");
    expect(result.message).toContain("Something went wrong");
  });

  it("classifies An unknown error occurred as retry", async () => {
    const provider = await loadProvider();
    const result = provider.classifyError("An unknown error occurred while processing");
    expect(result.type).toBe("retry");
  });

  it("classifies 2207081 as bad-body", async () => {
    const provider = await loadProvider();
    const result = provider.classifyError(
      new Error('{"error":{"code":2207081,"message":"Trial Reels not supported"}}'),
    );
    expect(result.type).toBe("bad-body");
    expect(result.message).toContain("Trial Reels");
  });

  it("classifies 2207009 (aspect ratio) as bad-body", async () => {
    const provider = await loadProvider();
    const result = provider.classifyError(
      new Error('{"error":{"code":2207009,"message":"Aspect ratio error"}}'),
    );
    expect(result.type).toBe("bad-body");
    expect(result.message).toContain("Aspect ratio");
  });

  it("classifies session invalidated as refresh-token", async () => {
    const provider = await loadProvider();
    const result = provider.classifyError(
      "session has been invalidated",
    );
    expect(result.type).toBe("refresh-token");
  });

  it("classifies non-IG-business account error as refresh-token", async () => {
    const provider = await loadProvider();
    const result = provider.classifyError(
      "the user is not an instagram business account",
    );
    expect(result.type).toBe("refresh-token");
  });

  it("classifies non-Error objects", async () => {
    const provider = await loadProvider();
    const result = provider.classifyError({ code: 99999, message: "unknown" });
    expect(result.type).toBe("retry");
  });
});

// ---------------------------------------------------------------------------
// getCapabilities
// ---------------------------------------------------------------------------

describe("instagramProvider.getCapabilities", () => {
  it("returns correct capabilities", async () => {
    const provider = await loadProvider();
    const caps = provider.getCapabilities();
    expect(caps.identifier).toBe("instagram");
    expect(caps.displayName).toBe("Instagram");
    expect(caps.maxContentLength).toBe(2200);
    expect(caps.supportsImages).toBe(true);
    expect(caps.supportsVideo).toBe(true);
    expect(caps.supportsCarousel).toBe(true);
    expect(caps.requiresPageSelection).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Provider interface conformance
// ---------------------------------------------------------------------------

describe("instagramProvider interface conformance", () => {
  it("has all required interface properties", async () => {
    const provider = await loadProvider();
    expect(provider.identifier).toBe("instagram");
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
