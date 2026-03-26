import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearRegistry } from "@/lib/social/provider-registry";

// ---------------------------------------------------------------------------
// Mock global fetch before importing the module under test
// ---------------------------------------------------------------------------

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// Import the module under test and the exported poll helper
import {
  pollTikTokPublishStatus,
  tikTokProvider,
} from "@/lib/social/providers/tiktok";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockFetchOk(body: unknown) {
  return {
    ok: true,
    status: 200,
    json: vi.fn().mockResolvedValue(body),
    text: vi.fn().mockResolvedValue(JSON.stringify(body)),
  };
}

function mockFetchError(status: number, text = "error") {
  return {
    ok: false,
    status,
    json: vi.fn().mockResolvedValue({}),
    text: vi.fn().mockResolvedValue(text),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("TikTok provider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearRegistry();

    process.env.TIKTOK_CLIENT_KEY = "test-client-key";
    process.env.TIKTOK_CLIENT_SECRET = "test-client-secret";
  });

  afterEach(() => {
    delete process.env.TIKTOK_CLIENT_KEY;
    delete process.env.TIKTOK_CLIENT_SECRET;
  });

  // -------------------------------------------------------------------------
  // generateAuthUrl
  // -------------------------------------------------------------------------

  describe("generateAuthUrl", () => {
    it("generates a TikTok OAuth URL with required scopes", async () => {
      const result = await tikTokProvider.generateAuthUrl(
        "https://app.example.com/callback/tiktok",
      );

      expect(result.url).toContain("tiktok.com/v2/auth/authorize");
      expect(result.url).toContain("video.publish");
      expect(result.url).toContain("video.upload");
      expect(result.url).toContain("user.info.basic");
      expect(result.state).toBeTruthy();
    });

    it("returns a unique state on each call", async () => {
      const r1 = await tikTokProvider.generateAuthUrl("https://example.com/cb");
      const r2 = await tikTokProvider.generateAuthUrl("https://example.com/cb");
      expect(r1.state).not.toBe(r2.state);
    });

    it("throws if TIKTOK_CLIENT_KEY is not set", async () => {
      delete process.env.TIKTOK_CLIENT_KEY;
      await expect(
        tikTokProvider.generateAuthUrl("https://example.com/cb"),
      ).rejects.toThrow("TIKTOK_CLIENT_KEY");
    });
  });

  // -------------------------------------------------------------------------
  // authenticate
  // -------------------------------------------------------------------------

  describe("authenticate", () => {
    it("exchanges code for tokens and returns user info with 23h expiry", async () => {
      // Token exchange call
      mockFetch
        .mockResolvedValueOnce(
          mockFetchOk({
            access_token: "tiktok-access-token",
            refresh_token: "tiktok-refresh-token",
          }),
        )
        // User info call
        .mockResolvedValueOnce(
          mockFetchOk({
            data: {
              user: {
                open_id: "open-id-123",
                display_name: "Test TikToker",
                avatar_url: "https://p16.tiktokcdn.com/avatar.jpg",
                username: "testtiktoker",
              },
            },
          }),
        );

      const result = await tikTokProvider.authenticate({
        code: "auth-code",
        state: "https://app.example.com/callback",
      });

      expect(result.platformUserId).toBe("openid123"); // dashes stripped
      expect(result.accessToken).toBe("tiktok-access-token");
      expect(result.refreshToken).toBe("tiktok-refresh-token");
      expect(result.expiresIn).toBe(23 * 60 * 60); // 23 hours in seconds
      expect(result.displayName).toBe("Test TikToker");
      expect(result.username).toBe("testtiktoker");
      expect(result.requiresPageSelection).toBe(false);
    });

    it("sends grant_type=authorization_code in token request", async () => {
      mockFetch
        .mockResolvedValueOnce(
          mockFetchOk({ access_token: "token", refresh_token: "refresh" }),
        )
        .mockResolvedValueOnce(
          mockFetchOk({
            data: {
              user: {
                open_id: "id-1",
                display_name: "User",
                avatar_url: "",
                username: "user",
              },
            },
          }),
        );

      await tikTokProvider.authenticate({ code: "code" });

      const tokenBody = new URLSearchParams(
        mockFetch.mock.calls[0][1].body as string,
      );
      expect(tokenBody.get("grant_type")).toBe("authorization_code");
    });

    it("strips dashes from open_id to form platformUserId", async () => {
      mockFetch
        .mockResolvedValueOnce(
          mockFetchOk({ access_token: "tok", refresh_token: "ref" }),
        )
        .mockResolvedValueOnce(
          mockFetchOk({
            data: {
              user: {
                open_id: "abcd-ef01-2345-6789",
                display_name: "User",
                avatar_url: "",
                username: "u",
              },
            },
          }),
        );

      const result = await tikTokProvider.authenticate({ code: "code" });
      expect(result.platformUserId).toBe("abcdef0123456789");
    });

    it("throws when token exchange fails with non-200", async () => {
      mockFetch.mockResolvedValueOnce(mockFetchError(400, "bad_request"));

      await expect(
        tikTokProvider.authenticate({ code: "bad-code" }),
      ).rejects.toThrow("TikTok token exchange failed: 400");
    });
  });

  // -------------------------------------------------------------------------
  // refreshToken
  // -------------------------------------------------------------------------

  describe("refreshToken", () => {
    it("exchanges refresh token for a new access token with 23h expiry", async () => {
      mockFetch.mockResolvedValueOnce(
        mockFetchOk({
          access_token: "new-access-token",
          refresh_token: "new-refresh-token",
        }),
      );

      const result = await tikTokProvider.refreshToken("old-refresh-token");

      expect(result.accessToken).toBe("new-access-token");
      expect(result.refreshToken).toBe("new-refresh-token");
      expect(result.expiresIn).toBe(23 * 60 * 60);
    });

    it("falls back to old refresh token if API does not return a new one", async () => {
      mockFetch.mockResolvedValueOnce(
        mockFetchOk({ access_token: "new-token" }), // no refresh_token
      );

      const result = await tikTokProvider.refreshToken("original-refresh");
      expect(result.refreshToken).toBe("original-refresh");
    });

    it("sends grant_type=refresh_token in the request body", async () => {
      mockFetch.mockResolvedValueOnce(
        mockFetchOk({ access_token: "tok", refresh_token: "ref" }),
      );

      await tikTokProvider.refreshToken("my-refresh-token");

      const body = new URLSearchParams(
        mockFetch.mock.calls[0][1].body as string,
      );
      expect(body.get("grant_type")).toBe("refresh_token");
      expect(body.get("refresh_token")).toBe("my-refresh-token");
    });

    it("throws on a 400 response", async () => {
      mockFetch.mockResolvedValueOnce(mockFetchError(400, "invalid_grant"));
      await expect(
        tikTokProvider.refreshToken("expired-token"),
      ).rejects.toThrow("TikTok token refresh failed: 400");
    });
  });

  // -------------------------------------------------------------------------
  // pollTikTokPublishStatus
  // -------------------------------------------------------------------------

  describe("pollTikTokPublishStatus", () => {
    it("returns post URL when status is PUBLISH_COMPLETE with public post id", async () => {
      mockFetch.mockResolvedValueOnce(
        mockFetchOk({
          data: {
            status: "PUBLISH_COMPLETE",
            publicaly_available_post_id: ["7312345678901234567"],
          },
        }),
      );

      const result = await pollTikTokPublishStatus(
        "mytiktokuser",
        "publish-id-1",
        "access-token",
        0,
      );

      expect(result.platformPostId).toBe("7312345678901234567");
      expect(result.platformPostUrl).toBe(
        "https://www.tiktok.com/@mytiktokuser/video/7312345678901234567",
      );
    });

    it("returns publishId as fallback when publicaly_available_post_id is absent", async () => {
      mockFetch.mockResolvedValueOnce(
        mockFetchOk({
          data: {
            status: "PUBLISH_COMPLETE",
            publicaly_available_post_id: [],
          },
        }),
      );

      const result = await pollTikTokPublishStatus(
        "user",
        "fallback-publish-id",
        "tok",
        0,
      );

      expect(result.platformPostId).toBe("fallback-publish-id");
      expect(result.platformPostUrl).toBe("https://www.tiktok.com/@user");
    });

    it("returns inbox URL when status is SEND_TO_USER_INBOX", async () => {
      mockFetch.mockResolvedValueOnce(
        mockFetchOk({ data: { status: "SEND_TO_USER_INBOX" } }),
      );

      const result = await pollTikTokPublishStatus("u", "pid", "tok", 0);
      expect(result.platformPostId).toBe("inbox");
      expect(result.platformPostUrl).toContain("tiktok.com/messages");
    });

    it("retries on intermediate status before resolving PUBLISH_COMPLETE", async () => {
      mockFetch
        .mockResolvedValueOnce(
          mockFetchOk({ data: { status: "PROCESSING_UPLOAD" } }),
        )
        .mockResolvedValueOnce(
          mockFetchOk({ data: { status: "PROCESSING_UPLOAD" } }),
        )
        .mockResolvedValueOnce(
          mockFetchOk({
            data: {
              status: "PUBLISH_COMPLETE",
              publicaly_available_post_id: ["9999"],
            },
          }),
        );

      const result = await pollTikTokPublishStatus("user", "pid", "tok", 0);
      expect(mockFetch).toHaveBeenCalledTimes(3);
      expect(result.platformPostId).toBe("9999");
    });

    it("throws when status is FAILED", async () => {
      mockFetch.mockResolvedValueOnce(
        mockFetchOk({
          data: {
            status: "FAILED",
            fail_reason: "spam_risk_too_many_posts",
          },
        }),
      );

      await expect(
        pollTikTokPublishStatus("u", "pid", "tok", 0),
      ).rejects.toThrow("TikTok publish failed");
    });
  });

  // -------------------------------------------------------------------------
  // post — video and photo dispatch
  // -------------------------------------------------------------------------

  describe("post", () => {
    it("initiates a video post and polls for publish status", async () => {
      // 1. video init call
      mockFetch
        .mockResolvedValueOnce(
          mockFetchOk({ data: { publish_id: "video-publish-id" } }),
        )
        // 2. user info (for username resolution)
        .mockResolvedValueOnce(
          mockFetchOk({
            data: {
              user: {
                open_id: "oid",
                display_name: "User",
                avatar_url: "",
                username: "videotiktoker",
              },
            },
          }),
        )
        // 3. poll status
        .mockResolvedValueOnce(
          mockFetchOk({
            data: {
              status: "PUBLISH_COMPLETE",
              publicaly_available_post_id: ["vid123"],
            },
          }),
        );

      const results = await tikTokProvider.post(
        "platform-user-id",
        "access-token",
        [
          {
            postId: "internal-post-1",
            content: "Check out my new video!",
            media: [{ type: "video", url: "https://cdn.example.com/video.mp4" }],
          },
        ],
      );

      expect(results).toHaveLength(1);
      expect(results[0].postId).toBe("internal-post-1");
      expect(results[0].platformPostId).toBe("vid123");
      expect(results[0].status).toBe("processing");
    });

    it("uses PULL_FROM_URL source_info for video posts", async () => {
      mockFetch
        .mockResolvedValueOnce(
          mockFetchOk({ data: { publish_id: "pid" } }),
        )
        .mockResolvedValueOnce(
          mockFetchOk({
            data: {
              user: {
                open_id: "oid",
                display_name: "U",
                avatar_url: "",
                username: "u",
              },
            },
          }),
        )
        .mockResolvedValueOnce(
          mockFetchOk({
            data: {
              status: "PUBLISH_COMPLETE",
              publicaly_available_post_id: ["vid"],
            },
          }),
        );

      await tikTokProvider.post("uid", "tok", [
        {
          postId: "p",
          content: "test",
          media: [{ type: "video", url: "https://example.com/v.mp4" }],
        },
      ]);

      const initBody = JSON.parse(mockFetch.mock.calls[0][1].body as string);
      expect(initBody.source_info.source).toBe("PULL_FROM_URL");
      expect(initBody.source_info.video_url).toBe("https://example.com/v.mp4");
    });

    it("initiates a photo carousel post with image URLs", async () => {
      mockFetch
        .mockResolvedValueOnce(
          mockFetchOk({ data: { publish_id: "photo-publish-id" } }),
        )
        .mockResolvedValueOnce(
          mockFetchOk({
            data: {
              user: {
                open_id: "oid",
                display_name: "User",
                avatar_url: "",
                username: "phototiktoker",
              },
            },
          }),
        )
        .mockResolvedValueOnce(
          mockFetchOk({
            data: {
              status: "PUBLISH_COMPLETE",
              publicaly_available_post_id: ["photo123"],
            },
          }),
        );

      const results = await tikTokProvider.post(
        "platform-user-id",
        "access-token",
        [
          {
            postId: "internal-post-2",
            content: "My photo carousel",
            media: [
              { type: "image", url: "https://cdn.example.com/img1.jpg" },
              { type: "image", url: "https://cdn.example.com/img2.jpg" },
            ],
          },
        ],
      );

      expect(results[0].postId).toBe("internal-post-2");
      expect(results[0].platformPostId).toBe("photo123");

      // Should have called the photo content init endpoint
      const initBody = JSON.parse(mockFetch.mock.calls[0][1].body as string);
      expect(initBody.media_type).toBe("PHOTO");
      expect(initBody.source_info.photo_images).toEqual([
        "https://cdn.example.com/img1.jpg",
        "https://cdn.example.com/img2.jpg",
      ]);
    });

    it("throws when no media is provided", async () => {
      await expect(
        tikTokProvider.post("uid", "tok", [
          { postId: "p1", content: "no media" },
        ]),
      ).rejects.toThrow("TikTok requires at least one media item");
    });
  });

  // -------------------------------------------------------------------------
  // classifyError
  // -------------------------------------------------------------------------

  describe("classifyError", () => {
    it("classifies access_token_invalid as refresh-token", () => {
      const err = new Error("access_token_invalid");
      expect(tikTokProvider.classifyError(err).type).toBe("refresh-token");
    });

    it("classifies scope_not_authorized as refresh-token", () => {
      const err = new Error("scope_not_authorized: missing scopes");
      expect(tikTokProvider.classifyError(err).type).toBe("refresh-token");
    });

    it("classifies scope_permission_missed as refresh-token", () => {
      const err = new Error("scope_permission_missed");
      expect(tikTokProvider.classifyError(err).type).toBe("refresh-token");
    });

    it("classifies spam_risk as bad-body", () => {
      const err = new Error("spam_risk_too_many_posts");
      expect(tikTokProvider.classifyError(err).type).toBe("bad-body");
    });

    it("classifies spam_risk_text as bad-body", () => {
      const err = new Error("spam_risk_text detected");
      expect(tikTokProvider.classifyError(err).type).toBe("bad-body");
    });

    it("classifies spam_risk_user_banned_from_posting as bad-body", () => {
      const err = new Error("spam_risk_user_banned_from_posting");
      expect(tikTokProvider.classifyError(err).type).toBe("bad-body");
    });

    it("classifies file_format_check_failed as bad-body", () => {
      const err = new Error("file_format_check_failed: unsupported codec");
      expect(tikTokProvider.classifyError(err).type).toBe("bad-body");
    });

    it("classifies duration_check_failed as bad-body", () => {
      const err = new Error("duration_check_failed: too long");
      expect(tikTokProvider.classifyError(err).type).toBe("bad-body");
    });

    it("classifies frame_rate_check_failed as bad-body", () => {
      const err = new Error("frame_rate_check_failed");
      expect(tikTokProvider.classifyError(err).type).toBe("bad-body");
    });

    it("classifies video_pull_failed as retry", () => {
      const err = new Error("video_pull_failed: network error");
      expect(tikTokProvider.classifyError(err).type).toBe("retry");
    });

    it("classifies photo_pull_failed as retry", () => {
      const err = new Error("photo_pull_failed: timeout");
      expect(tikTokProvider.classifyError(err).type).toBe("retry");
    });

    it("classifies rate_limit_exceeded as retry", () => {
      const err = new Error("rate_limit_exceeded");
      expect(tikTokProvider.classifyError(err).type).toBe("retry");
    });

    it("classifies url_ownership_unverified as bad-body", () => {
      const err = new Error("url_ownership_unverified");
      expect(tikTokProvider.classifyError(err).type).toBe("bad-body");
    });

    it("classifies unaudited_client_can_only_post_to_private_accounts as bad-body", () => {
      const err = new Error(
        "unaudited_client_can_only_post_to_private_accounts",
      );
      expect(tikTokProvider.classifyError(err).type).toBe("bad-body");
    });

    it("classifies unknown errors as retry", () => {
      const err = new Error("some random network failure");
      expect(tikTokProvider.classifyError(err).type).toBe("retry");
    });

    it("includes the original error in the result", () => {
      const err = new Error("something");
      const classified = tikTokProvider.classifyError(err);
      expect(classified.original).toBe(err);
    });

    it("handles non-Error objects", () => {
      const classified = tikTokProvider.classifyError("raw string error");
      expect(classified.type).toBe("retry");
      expect(classified.message).toBe("raw string error");
    });
  });

  // -------------------------------------------------------------------------
  // getCapabilities
  // -------------------------------------------------------------------------

  describe("getCapabilities", () => {
    it("returns the expected TikTok capabilities", () => {
      const caps = tikTokProvider.getCapabilities();
      expect(caps.identifier).toBe("tiktok");
      expect(caps.displayName).toBe("TikTok");
      expect(caps.supportsImages).toBe(true);
      expect(caps.supportsVideo).toBe(true);
      expect(caps.supportsCarousel).toBe(true);
      expect(caps.requiresPageSelection).toBe(false);
      expect(caps.maxContentLength).toBe(2200);
    });
  });
});
