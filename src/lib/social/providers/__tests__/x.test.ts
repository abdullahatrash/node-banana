/**
 * X (Twitter) provider tests.
 *
 * The `twitter-api-v2` package is fully mocked so no network calls are made.
 * sharp is mocked to return a fixed buffer without actual image processing.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearRegistry } from "@/lib/social/provider-registry";

// ---------------------------------------------------------------------------
// Hoist mock state so vi.mock factories can reference it
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  // TwitterApi instance methods used in various flows
  generateAuthLink: vi.fn(),
  login: vi.fn(),
  me: vi.fn(),
  uploadMedia: vi.fn(),
  tweet: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Mock twitter-api-v2
//
// The provider does:
//   new TwitterApi({ appKey, appSecret })              → for generateAuthUrl
//   new TwitterApi({ appKey, appSecret, accessToken, accessSecret }) → for post
//   startingClient.login(oauthVerifier)                → returns { accessToken, accessSecret, client }
//   client.v2.me()                                     → returns user info
//   client.v2.uploadMedia()                            → returns media id
//   client.v2.tweet()                                  → returns { data: { id } }
// ---------------------------------------------------------------------------

vi.mock("twitter-api-v2", () => {
  class TwitterApiV2Mock {
    me = mocks.me;
    uploadMedia = mocks.uploadMedia;
    tweet = mocks.tweet;
  }

  class TwitterApiMock {
    generateAuthLink = mocks.generateAuthLink;
    login = mocks.login;
    v2 = new TwitterApiV2Mock();
  }

  return { TwitterApi: TwitterApiMock };
});

// ---------------------------------------------------------------------------
// Mock sharp to avoid real image processing
// ---------------------------------------------------------------------------

vi.mock("sharp", () => {
  const sharpMock = vi.fn().mockReturnValue({
    resize: vi.fn().mockReturnThis(),
    toBuffer: vi.fn().mockResolvedValue(Buffer.from("resized-image-bytes")),
  });
  return { default: sharpMock };
});

// ---------------------------------------------------------------------------
// Mock global fetch (used by fetchAndResizeImage)
// ---------------------------------------------------------------------------

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// ---------------------------------------------------------------------------
// Import provider after all mocks are set up
// ---------------------------------------------------------------------------

import { xProvider } from "@/lib/social/providers/x";

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

beforeEach(() => {
  clearRegistry();
  vi.clearAllMocks();
  process.env.X_API_KEY = "test-api-key";
  process.env.X_API_SECRET = "test-api-secret";
});

afterEach(() => {
  delete process.env.X_API_KEY;
  delete process.env.X_API_SECRET;
});

// ---------------------------------------------------------------------------
// generateAuthUrl
// ---------------------------------------------------------------------------

describe("xProvider.generateAuthUrl", () => {
  it("calls generateAuthLink and returns url, state, and codeVerifier", async () => {
    mocks.generateAuthLink.mockResolvedValue({
      url: "https://api.twitter.com/oauth/authenticate?oauth_token=tok123",
      oauth_token: "tok123",
      oauth_token_secret: "sec456",
    });

    const result = await xProvider.generateAuthUrl(
      "https://example.com/callback/x",
    );

    expect(mocks.generateAuthLink).toHaveBeenCalledWith(
      "https://example.com/callback/x",
      expect.objectContaining({ authAccessType: "write" }),
    );

    expect(result.url).toContain("oauth_token=tok123");
    expect(result.state).toBe("tok123");
    expect(result.codeVerifier).toBe("tok123:sec456");
  });

  it("throws when X_API_KEY is not set", async () => {
    delete process.env.X_API_KEY;
    await expect(
      xProvider.generateAuthUrl("https://example.com/cb"),
    ).rejects.toThrow("X_API_KEY");
  });
});

// ---------------------------------------------------------------------------
// authenticate
// ---------------------------------------------------------------------------

describe("xProvider.authenticate", () => {
  it("calls login with the verifier and returns permanent tokens", async () => {
    const mockClient = {
      v2: {
        me: vi.fn().mockResolvedValue({
          data: {
            id: "user-111",
            name: "Alice",
            username: "alice",
            profile_image_url: "https://example.com/alice.jpg",
          },
        }),
      },
    };

    mocks.login.mockResolvedValue({
      accessToken: "perm-access",
      accessSecret: "perm-secret",
      client: mockClient,
    });

    const result = await xProvider.authenticate({
      code: "oauth-verifier-xyz",
      state: "oauth-state",
      redirectUri: "https://app.example.com/callback/x",
      codeVerifier: "tok123:sec456",
    });

    expect(mocks.login).toHaveBeenCalledWith("oauth-verifier-xyz");

    expect(result.platformUserId).toBe("user-111");
    // Token is stored as "accessToken:accessSecret"
    expect(result.accessToken).toBe("perm-access:perm-secret");
    expect(result.displayName).toBe("Alice");
    expect(result.username).toBe("alice");
    expect(result.avatarUrl).toBe("https://example.com/alice.jpg");
    // No expiry for OAuth 1.0a
    expect(result.expiresIn).toBeUndefined();
    expect(result.refreshToken).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// refreshToken
// ---------------------------------------------------------------------------

describe("xProvider.refreshToken", () => {
  it("is a no-op — returns the same token unchanged", async () => {
    const result = await xProvider.refreshToken("my-permanent-token:my-secret");
    expect(result.accessToken).toBe("my-permanent-token:my-secret");
  });

  it("does not make any network calls", async () => {
    await xProvider.refreshToken("tok:sec");
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// post
// ---------------------------------------------------------------------------

describe("xProvider.post", () => {
  it("posts text-only tweet without uploading media", async () => {
    mocks.tweet.mockResolvedValue({ data: { id: "tweet-999" } });
    mocks.me.mockResolvedValue({ data: { username: "alice" } });

    const results = await xProvider.post("user-111", "tok:sec", [
      { postId: "our-post-1", content: "Hello X!" },
    ]);

    expect(mocks.tweet).toHaveBeenCalledWith(
      expect.objectContaining({ text: "Hello X!" }),
    );
    expect(results).toHaveLength(1);
    expect(results[0].postId).toBe("our-post-1");
    expect(results[0].platformPostId).toBe("tweet-999");
    expect(results[0].platformPostUrl).toContain("alice");
    expect(results[0].platformPostUrl).toContain("tweet-999");
    expect(results[0].status).toBe("published");
  });

  it("downloads, resizes, and uploads images before tweeting", async () => {
    // Mock fetch for image download
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      arrayBuffer: async () => Buffer.from("raw-image").buffer,
    });

    mocks.uploadMedia.mockResolvedValue("media-id-001");
    mocks.tweet.mockResolvedValue({ data: { id: "tweet-with-img" } });
    mocks.me.mockResolvedValue({ data: { username: "alice" } });

    const results = await xProvider.post("user-111", "tok:sec", [
      {
        postId: "post-img",
        content: "Look at this!",
        media: [{ type: "image", url: "https://cdn.example.com/photo.jpg" }],
      },
    ]);

    expect(mockFetch).toHaveBeenCalledWith(
      "https://cdn.example.com/photo.jpg",
    );
    expect(mocks.uploadMedia).toHaveBeenCalledWith(
      expect.any(Buffer),
      expect.objectContaining({ media_type: "image/jpeg" }),
    );
    expect(mocks.tweet).toHaveBeenCalledWith(
      expect.objectContaining({
        media: { media_ids: ["media-id-001"] },
      }),
    );
    expect(results[0].platformPostId).toBe("tweet-with-img");
  });

  it("caps media uploads at 4 images", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      arrayBuffer: async () => Buffer.from("img").buffer,
    });
    mocks.uploadMedia.mockResolvedValue("media-id");
    mocks.tweet.mockResolvedValue({ data: { id: "tweet-capped" } });
    mocks.me.mockResolvedValue({ data: { username: "alice" } });

    await xProvider.post("user-111", "tok:sec", [
      {
        postId: "post-5imgs",
        content: "Five images",
        media: [
          { type: "image", url: "https://cdn.example.com/1.jpg" },
          { type: "image", url: "https://cdn.example.com/2.jpg" },
          { type: "image", url: "https://cdn.example.com/3.jpg" },
          { type: "image", url: "https://cdn.example.com/4.jpg" },
          { type: "image", url: "https://cdn.example.com/5.jpg" }, // should be dropped
        ],
      },
    ]);

    // Only 4 upload calls despite 5 images
    expect(mocks.uploadMedia).toHaveBeenCalledTimes(4);
  });

  it("returns empty array when requests array is empty", async () => {
    const results = await xProvider.post("user-111", "tok:sec", []);
    expect(results).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// classifyError
// ---------------------------------------------------------------------------

describe("xProvider.classifyError", () => {
  it("classifies 429 / rate limit as retry", () => {
    const result = xProvider.classifyError(new Error("429 Too Many Requests"));
    expect(result.type).toBe("retry");
  });

  it("classifies Rate limit exceeded string as retry", () => {
    const result = xProvider.classifyError("Rate limit exceeded");
    expect(result.type).toBe("retry");
  });

  it("classifies 401 as refresh-token", () => {
    const result = xProvider.classifyError(new Error("401 Unauthorized"));
    expect(result.type).toBe("refresh-token");
  });

  it("classifies Unsupported Authentication as refresh-token", () => {
    const result = xProvider.classifyError(
      new Error("Unsupported Authentication"),
    );
    expect(result.type).toBe("refresh-token");
  });

  it("classifies duplicate tweet as bad-body", () => {
    const result = xProvider.classifyError(
      new Error("duplicate tweet content"),
    );
    expect(result.type).toBe("bad-body");
  });

  it("classifies usage-capped as bad-body", () => {
    const result = xProvider.classifyError(new Error("usage-capped reached"));
    expect(result.type).toBe("bad-body");
  });

  it("classifies unknown errors as retry", () => {
    const result = xProvider.classifyError(new Error("Something random"));
    expect(result.type).toBe("retry");
    expect(result.message).toContain("Something random");
  });

  it("classifies non-Error objects", () => {
    const result = xProvider.classifyError({ code: 500, detail: "oops" });
    expect(result.type).toBe("retry");
  });

  it("preserves the original error", () => {
    const original = new Error("X error");
    const result = xProvider.classifyError(original);
    expect(result.original).toBe(original);
  });
});

// ---------------------------------------------------------------------------
// getCapabilities
// ---------------------------------------------------------------------------

describe("xProvider.getCapabilities", () => {
  it("returns correct capabilities", () => {
    const caps = xProvider.getCapabilities();
    expect(caps.identifier).toBe("x");
    expect(caps.displayName).toBe("X (Twitter)");
    expect(caps.maxContentLength).toBe(280);
    expect(caps.supportsImages).toBe(true);
    expect(caps.supportsVideo).toBe(false);
    expect(caps.supportsCarousel).toBe(false);
    expect(caps.requiresPageSelection).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Interface conformance
// ---------------------------------------------------------------------------

describe("xProvider interface conformance", () => {
  it("has all required interface properties and methods", () => {
    expect(xProvider.identifier).toBe("x");
    expect(xProvider.maxImages).toBe(4);
    expect(xProvider.maxConcurrentJobs).toBe(1);
    expect(xProvider.requiresPageSelection).toBe(false);
    expect(typeof xProvider.generateAuthUrl).toBe("function");
    expect(typeof xProvider.authenticate).toBe("function");
    expect(typeof xProvider.refreshToken).toBe("function");
    expect(typeof xProvider.post).toBe("function");
    expect(typeof xProvider.classifyError).toBe("function");
    expect(typeof xProvider.getCapabilities).toBe("function");
    // fetchPageInformation is optional and should NOT be defined for X
    expect(xProvider.fetchPageInformation).toBeUndefined();
  });
});
