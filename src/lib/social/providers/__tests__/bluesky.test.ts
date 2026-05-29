import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearRegistry } from "@/lib/social/provider-registry";

const mockAgent = {
  login: vi.fn(),
  resumeSession: vi.fn(),
  session: {
    did: "did:plc:test123",
    handle: "alice.bsky.social",
    accessJwt: "new-access-jwt",
    refreshJwt: "new-refresh-jwt",
  },
  getProfile: vi.fn(),
  uploadBlob: vi.fn(),
  post: vi.fn(),
  com: {
    atproto: {
      identity: {
        resolveHandle: vi.fn(),
      },
    },
  },
};

vi.mock("@atproto/api", () => ({
  AtpAgent: vi.fn(function () {
    return mockAgent;
  }),
}));

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// Import after mocks are set up
const { blueskyProvider } = await import("@/lib/social/providers/bluesky");

describe("blueskyProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearRegistry();
    // Re-register after clear since the module-level registerProvider already ran
    // We do this by resetting mock state only; the provider object reference persists
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("capabilities", () => {
    it("has the correct identifier and capabilities", () => {
      expect(blueskyProvider.identifier).toBe("bluesky");
      expect(blueskyProvider.maxContentLength).toBe(300);
      expect(blueskyProvider.supportsImages).toBe(true);
      expect(blueskyProvider.supportsVideo).toBe(false);
      expect(blueskyProvider.maxImages).toBe(4);
      expect(blueskyProvider.requiresPageSelection).toBe(false);
    });

    it("getCapabilities returns correct values", () => {
      const caps = blueskyProvider.getCapabilities();
      expect(caps.identifier).toBe("bluesky");
      expect(caps.maxContentLength).toBe(300);
      expect(caps.supportsImages).toBe(true);
      expect(caps.supportsVideo).toBe(false);
      expect(caps.requiresPageSelection).toBe(false);
    });
  });

  describe("generateAuthUrl", () => {
    it("throws because Bluesky uses App Password, not OAuth redirect", async () => {
      await expect(
        blueskyProvider.generateAuthUrl("https://example.com/callback"),
      ).rejects.toThrow();
    });
  });

  describe("authenticate", () => {
    it("calls agent.login with stripped handle and app password, returns correct result", async () => {
      mockAgent.login.mockResolvedValueOnce({
        data: {
          did: "did:plc:test123",
          handle: "alice.bsky.social",
          accessJwt: "access-jwt",
          refreshJwt: "refresh-jwt",
        },
      });
      mockAgent.getProfile.mockResolvedValueOnce({
        data: {
          did: "did:plc:test123",
          handle: "alice.bsky.social",
          displayName: "Alice",
          avatar: "https://cdn.bsky.app/avatar.jpg",
        },
      });

      const result = await blueskyProvider.authenticate({
        code: "app-password-here",
        state: "@alice.bsky.social",
        redirectUri: "",
      });

      expect(result.platformUserId).toBe("did:plc:test123");
      expect(result.displayName).toBe("Alice");
      expect(result.accessToken).toBe("access-jwt");
      expect(mockAgent.login).toHaveBeenCalledWith({
        identifier: "alice.bsky.social",
        password: "app-password-here",
      });
    });

    it("stores refreshToken as JSON with refreshJwt, did, handle", async () => {
      mockAgent.login.mockResolvedValueOnce({
        data: {
          did: "did:plc:test123",
          handle: "alice.bsky.social",
          accessJwt: "access-jwt",
          refreshJwt: "refresh-jwt",
        },
      });
      mockAgent.getProfile.mockResolvedValueOnce({
        data: {
          did: "did:plc:test123",
          handle: "alice.bsky.social",
          displayName: "Alice",
          avatar: "https://cdn.bsky.app/avatar.jpg",
        },
      });

      const result = await blueskyProvider.authenticate({
        code: "app-password-here",
        state: "alice.bsky.social",
        redirectUri: "",
      });

      expect(result.refreshToken).toBeDefined();
      const parsed = JSON.parse(result.refreshToken!);
      expect(parsed.refreshJwt).toBe("refresh-jwt");
      expect(parsed.did).toBe("did:plc:test123");
      expect(parsed.handle).toBe("alice.bsky.social");
    });

    it("strips leading @ from handle before calling login", async () => {
      mockAgent.login.mockResolvedValueOnce({
        data: {
          did: "did:plc:abc",
          handle: "bob.bsky.social",
          accessJwt: "token",
          refreshJwt: "rtoken",
        },
      });
      mockAgent.getProfile.mockResolvedValueOnce({
        data: {
          did: "did:plc:abc",
          handle: "bob.bsky.social",
          displayName: "Bob",
        },
      });

      await blueskyProvider.authenticate({
        code: "pass",
        state: "@bob.bsky.social",
        redirectUri: "",
      });

      expect(mockAgent.login).toHaveBeenCalledWith({
        identifier: "bob.bsky.social",
        password: "pass",
      });
    });
  });

  describe("refreshToken", () => {
    it("resumes session with refreshJwt and returns new accessJwt", async () => {
      mockAgent.resumeSession.mockResolvedValueOnce(undefined);
      // After resumeSession, the agent.session is updated
      mockAgent.session = {
        did: "did:plc:test123",
        handle: "alice.bsky.social",
        accessJwt: "new-access-jwt",
        refreshJwt: "new-refresh-jwt",
      };

      const refreshTokenJson = JSON.stringify({
        refreshJwt: "old-refresh-jwt",
        did: "did:plc:test123",
        handle: "alice.bsky.social",
      });

      const result = await blueskyProvider.refreshToken(refreshTokenJson);

      expect(mockAgent.resumeSession).toHaveBeenCalledWith(
        expect.objectContaining({ refreshJwt: "old-refresh-jwt" }),
      );
      expect(result.accessToken).toBe("new-access-jwt");
    });
  });

  describe("post", () => {
    beforeEach(() => {
      mockAgent.session = {
        did: "did:plc:test123",
        handle: "alice.bsky.social",
        accessJwt: "current-access-jwt",
        refreshJwt: "current-refresh-jwt",
      };
      mockAgent.resumeSession.mockResolvedValue(undefined);
    });

    it("creates a text-only post and returns correct result", async () => {
      mockAgent.post.mockResolvedValueOnce({
        uri: "at://did:plc:test123/app.bsky.feed.post/abc123",
        cid: "bafyreiabc123",
      });
      mockAgent.com.atproto.identity.resolveHandle.mockRejectedValue(
        new Error("not found"),
      );

      const results = await blueskyProvider.post(
        "did:plc:test123",
        "access-jwt",
        [
          {
            postId: "post_1",
            content: "Hello Bluesky!",
          },
        ],
      );

      expect(results).toHaveLength(1);
      expect(results[0].postId).toBe("post_1");
      expect(results[0].status).toBe("published");
      expect(results[0].platformPostId).toBe(
        "at://did:plc:test123/app.bsky.feed.post/abc123",
      );
      expect(results[0].platformPostUrl).toBe(
        "https://bsky.app/profile/did:plc:test123/post/abc123",
      );
    });

    it("creates a post with images", async () => {
      const imageBuffer = new ArrayBuffer(100);
      const mockResponse = {
        ok: true,
        arrayBuffer: vi.fn().mockResolvedValue(imageBuffer),
        headers: {
          get: vi.fn().mockReturnValue("image/jpeg"),
        },
      };
      mockFetch.mockResolvedValue(mockResponse);

      mockAgent.uploadBlob.mockResolvedValue({
        data: {
          blob: {
            $type: "blob",
            ref: { $link: "bafyreisomehash" },
            mimeType: "image/jpeg",
            size: 100,
          },
        },
      });

      mockAgent.post.mockResolvedValueOnce({
        uri: "at://did:plc:test123/app.bsky.feed.post/imgpost",
        cid: "bafyreiimagecid",
      });
      mockAgent.com.atproto.identity.resolveHandle.mockRejectedValue(
        new Error("not found"),
      );

      const results = await blueskyProvider.post(
        "did:plc:test123",
        "access-jwt",
        [
          {
            postId: "post_2",
            content: "Post with image",
            media: [
              {
                type: "image",
                url: "https://example.com/photo.jpg",
                alt: "A photo",
                mimeType: "image/jpeg",
              },
            ],
          },
        ],
      );

      expect(results).toHaveLength(1);
      expect(results[0].status).toBe("published");
      expect(mockAgent.uploadBlob).toHaveBeenCalledTimes(1);
      // agent.post should have been called with embed containing images
      const postCall = mockAgent.post.mock.calls[0][0];
      expect(postCall.embed).toBeDefined();
      expect(postCall.embed.$type).toBe("app.bsky.embed.images");
      expect(postCall.embed.images).toHaveLength(1);
      expect(postCall.embed.images[0].alt).toBe("A photo");
    });

    it("resumes session using the stored access token", async () => {
      mockAgent.post.mockResolvedValueOnce({
        uri: "at://did:plc:test123/app.bsky.feed.post/resume1",
        cid: "bafyreiresumed",
      });
      mockAgent.com.atproto.identity.resolveHandle.mockRejectedValue(
        new Error("not found"),
      );

      await blueskyProvider.post("did:plc:test123", "stored-access-jwt", [
        { postId: "post_r", content: "Resume test" },
      ]);

      expect(mockAgent.resumeSession).toHaveBeenCalled();
    });
  });

  describe("classifyError", () => {
    it("classifies ExpiredToken as refresh-token", () => {
      const result = blueskyProvider.classifyError(
        new Error("ExpiredToken: the jwt has expired"),
      );
      expect(result.type).toBe("refresh-token");
    });

    it("classifies InvalidRequest record is invalid as bad-body", () => {
      const result = blueskyProvider.classifyError(
        new Error("InvalidRequest: record is invalid"),
      );
      expect(result.type).toBe("bad-body");
    });

    it("classifies RateLimitExceeded as retry", () => {
      const result = blueskyProvider.classifyError(
        new Error("RateLimitExceeded: too many requests"),
      );
      expect(result.type).toBe("retry");
    });

    it("defaults unknown errors to retry", () => {
      const result = blueskyProvider.classifyError(
        new Error("Some unknown Bluesky error"),
      );
      expect(result.type).toBe("retry");
    });
  });
});
