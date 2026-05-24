import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearRegistry } from "@/lib/social/provider-registry";

// ---------------------------------------------------------------------------
// Mock the googleapis module before importing the provider.
//
// The googleapis OAuth2 class is instantiated via `new google.auth.OAuth2()`.
// We use vi.hoisted() to declare per-test callable stubs and wire them into a
// proper ES6 class constructor in the vi.mock() factory so `new` works.
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  getToken: vi.fn(),
  setCredentials: vi.fn(),
  refreshAccessToken: vi.fn(),
  generateAuthUrl: vi.fn(),
  userinfoGet: vi.fn(),
  channelsList: vi.fn(),
  videosInsert: vi.fn(),
  thumbnailsSet: vi.fn(),
}));

vi.mock("googleapis", () => {
  // OAuth2 must be a real constructor (class/function) because the provider
  // calls `new google.auth.OAuth2(...)`.
  class OAuth2Mock {
    getToken = mocks.getToken;
    setCredentials = mocks.setCredentials;
    refreshAccessToken = mocks.refreshAccessToken;
    generateAuthUrl = mocks.generateAuthUrl;
  }

  return {
    google: {
      auth: { OAuth2: OAuth2Mock },
      youtube: vi.fn().mockReturnValue({
        channels: { list: mocks.channelsList },
        videos: { insert: mocks.videosInsert },
        thumbnails: { set: mocks.thumbnailsSet },
      }),
      oauth2: vi.fn().mockReturnValue({
        userinfo: { get: mocks.userinfoGet },
      }),
    },
  };
});

// Mock global fetch for video/thumbnail URL downloads
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// Import the module under test after mocks are set up
import { youTubeProvider } from "@/lib/social/providers/youtube";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeReadableStream() {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array([0, 1, 2, 3]));
      controller.close();
    },
  });
}

function videoFetchResponse() {
  return {
    ok: true,
    status: 200,
    body: makeReadableStream(),
  };
}

const FAKE_ACCESS_TOKEN = "google-access-token";
const FAKE_REFRESH_TOKEN = "google-refresh-token";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("YouTube provider", () => {
  beforeEach(() => {
    // clearAllMocks preserves mock implementations set up by vi.mock() but
    // resets per-test return values and recorded calls.
    vi.clearAllMocks();
    clearRegistry();

    process.env.GOOGLE_CLIENT_ID = "test-google-client-id";
    process.env.GOOGLE_CLIENT_SECRET = "test-google-client-secret";
  });

  afterEach(() => {
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
  });

  // -------------------------------------------------------------------------
  // generateAuthUrl
  // -------------------------------------------------------------------------

  describe("generateAuthUrl", () => {
    it("generates an auth URL with offline access and consent prompt", async () => {
      mocks.generateAuthUrl.mockReturnValue(
        "https://accounts.google.com/o/oauth2/auth?access_type=offline&prompt=consent",
      );

      const result = await youTubeProvider.generateAuthUrl(
        "https://app.example.com/callback/youtube",
      );

      expect(result.url).toContain("accounts.google.com");
      expect(result.url).toContain("access_type=offline");
      expect(result.url).toContain("prompt=consent");
      expect(result.state).toBeTruthy();
    });

    it("calls generateAuthUrl with access_type=offline and prompt=consent", async () => {
      mocks.generateAuthUrl.mockReturnValue("https://accounts.google.com/auth");

      await youTubeProvider.generateAuthUrl("https://example.com/cb");

      expect(mocks.generateAuthUrl).toHaveBeenCalledWith(
        expect.objectContaining({
          access_type: "offline",
          prompt: "consent",
        }),
      );
    });

    it("includes YouTube upload scope in the auth URL parameters", async () => {
      mocks.generateAuthUrl.mockReturnValue("https://accounts.google.com/auth");

      await youTubeProvider.generateAuthUrl("https://example.com/cb");

      const callArgs = mocks.generateAuthUrl.mock.calls[0][0];
      expect(callArgs.scope).toContain(
        "https://www.googleapis.com/auth/youtube.upload",
      );
    });

    it("generates a unique state on each call", async () => {
      mocks.generateAuthUrl.mockReturnValue("https://accounts.google.com/auth");

      const r1 = await youTubeProvider.generateAuthUrl("https://example.com/cb");
      const r2 = await youTubeProvider.generateAuthUrl("https://example.com/cb");

      expect(r1.state).not.toBe(r2.state);
    });

    it("throws if GOOGLE_CLIENT_ID is not set", async () => {
      delete process.env.GOOGLE_CLIENT_ID;
      await expect(
        youTubeProvider.generateAuthUrl("https://example.com/cb"),
      ).rejects.toThrow("GOOGLE_CLIENT_ID");
    });
  });

  // -------------------------------------------------------------------------
  // authenticate
  // -------------------------------------------------------------------------

  describe("authenticate", () => {
    it("exchanges code for tokens and returns user info", async () => {
      const expiryDate = Date.now() + 3600 * 1000; // 1 hour from now

      mocks.getToken.mockResolvedValue({
        tokens: {
          access_token: FAKE_ACCESS_TOKEN,
          refresh_token: FAKE_REFRESH_TOKEN,
          expiry_date: expiryDate,
        },
      });

      mocks.userinfoGet.mockResolvedValue({
        data: {
          id: "google-user-123",
          name: "Test User",
          picture: "https://lh3.googleusercontent.com/photo.jpg",
        },
      });

      const result = await youTubeProvider.authenticate({
        code: "auth-code",
        state: "oauth-state",
        redirectUri: "https://app.example.com/callback/youtube",
      });

      expect(result.platformUserId).toBe("google-user-123");
      expect(result.accessToken).toBe(FAKE_ACCESS_TOKEN);
      expect(result.refreshToken).toBe(FAKE_REFRESH_TOKEN);
      expect(result.displayName).toBe("Test User");
      expect(result.avatarUrl).toBe(
        "https://lh3.googleusercontent.com/photo.jpg",
      );
      expect(result.requiresPageSelection).toBe(true);
      // expiresIn must be a positive number of seconds
      expect(result.expiresIn).toBeGreaterThan(0);
    });

    it("sets credentials on the OAuth2 client after token exchange", async () => {
      mocks.getToken.mockResolvedValue({
        tokens: {
          access_token: FAKE_ACCESS_TOKEN,
          refresh_token: FAKE_REFRESH_TOKEN,
        },
      });
      mocks.userinfoGet.mockResolvedValue({
        data: { id: "uid", name: "User", picture: null },
      });

      await youTubeProvider.authenticate({
        code: "code",
        state: "oauth-state",
        redirectUri: "https://app.example.com/callback/youtube",
      });

      expect(mocks.setCredentials).toHaveBeenCalledWith(
        expect.objectContaining({ access_token: FAKE_ACCESS_TOKEN }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // refreshToken
  // -------------------------------------------------------------------------

  describe("refreshToken", () => {
    it("refreshes the access token using the OAuth2 client", async () => {
      const expiryDate = Date.now() + 3600 * 1000;
      mocks.refreshAccessToken.mockResolvedValue({
        credentials: {
          access_token: "new-access-token",
          refresh_token: "new-refresh-token",
          expiry_date: expiryDate,
        },
      });

      const result = await youTubeProvider.refreshToken(FAKE_REFRESH_TOKEN);

      expect(mocks.setCredentials).toHaveBeenCalledWith({
        refresh_token: FAKE_REFRESH_TOKEN,
      });
      expect(result.accessToken).toBe("new-access-token");
      expect(result.refreshToken).toBe("new-refresh-token");
      expect(result.expiresIn).toBeGreaterThan(0);
    });

    it("falls back to old refresh token if API does not return a new one", async () => {
      mocks.refreshAccessToken.mockResolvedValue({
        credentials: {
          access_token: "new-token",
          expiry_date: Date.now() + 3_600_000,
        },
      });

      const result = await youTubeProvider.refreshToken(FAKE_REFRESH_TOKEN);
      expect(result.refreshToken).toBe(FAKE_REFRESH_TOKEN);
    });

    it("throws if GOOGLE_CLIENT_ID is missing", async () => {
      delete process.env.GOOGLE_CLIENT_ID;
      await expect(
        youTubeProvider.refreshToken(FAKE_REFRESH_TOKEN),
      ).rejects.toThrow("GOOGLE_CLIENT_ID");
    });
  });

  // -------------------------------------------------------------------------
  // fetchPageInformation (channel listing)
  // -------------------------------------------------------------------------

  describe("fetchPageInformation", () => {
    it("returns a list of YouTube channels for the account", async () => {
      mocks.channelsList.mockResolvedValue({
        data: {
          items: [
            {
              id: "UC_channel_id_1",
              snippet: {
                title: "My Channel",
                customUrl: "@mychannel",
                thumbnails: {
                  default: { url: "https://yt3.ggpht.com/thumb.jpg" },
                },
              },
            },
            {
              id: "UC_channel_id_2",
              snippet: {
                title: "Brand Channel",
                customUrl: "@brand",
                thumbnails: { default: null },
              },
            },
          ],
        },
      });

      const pages = await youTubeProvider.fetchPageInformation!(
        FAKE_ACCESS_TOKEN,
      );

      expect(pages).toHaveLength(2);
      expect(pages[0].id).toBe("UC_channel_id_1");
      expect(pages[0].name).toBe("My Channel");
      expect(pages[0].username).toBe("@mychannel");
      expect(pages[0].picture).toBe("https://yt3.ggpht.com/thumb.jpg");
      expect(pages[1].id).toBe("UC_channel_id_2");
    });

    it("returns an empty array when no channels found", async () => {
      mocks.channelsList.mockResolvedValue({ data: { items: [] } });

      const pages = await youTubeProvider.fetchPageInformation!(
        FAKE_ACCESS_TOKEN,
      );
      expect(pages).toHaveLength(0);
    });

    it("calls channels.list with part=['snippet'] and mine=true", async () => {
      mocks.channelsList.mockResolvedValue({ data: { items: [] } });

      await youTubeProvider.fetchPageInformation!(FAKE_ACCESS_TOKEN);

      expect(mocks.channelsList).toHaveBeenCalledWith({
        part: ["snippet"],
        mine: true,
      });
    });
  });

  // -------------------------------------------------------------------------
  // post (video upload)
  // -------------------------------------------------------------------------

  describe("post", () => {
    it("uploads a video and returns a YouTube watch URL", async () => {
      mockFetch.mockResolvedValue(videoFetchResponse());
      mocks.videosInsert.mockResolvedValue({ data: { id: "dQw4w9WgXcQ" } });

      const results = await youTubeProvider.post(
        "google-user-123",
        FAKE_ACCESS_TOKEN,
        [
          {
            postId: "internal-post-1",
            content: "My awesome video description",
            media: [
              {
                type: "video",
                url: "https://cdn.example.com/video.mp4",
              },
            ],
            platformSettings: {
              title: "My Awesome Video",
              privacyStatus: "public",
            },
          },
        ],
      );

      expect(results).toHaveLength(1);
      expect(results[0].postId).toBe("internal-post-1");
      expect(results[0].platformPostId).toBe("dQw4w9WgXcQ");
      expect(results[0].platformPostUrl).toBe(
        "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      );
      expect(results[0].status).toBe("published");
    });

    it("calls videos.insert with snippet and status parts", async () => {
      mockFetch.mockResolvedValue(videoFetchResponse());
      mocks.videosInsert.mockResolvedValue({ data: { id: "abc123" } });

      await youTubeProvider.post(
        "uid",
        FAKE_ACCESS_TOKEN,
        [
          {
            postId: "p1",
            content: "Description text",
            media: [{ type: "video", url: "https://example.com/v.mp4" }],
            platformSettings: {
              title: "My Title",
              privacyStatus: "unlisted",
              tags: ["tag1", "tag2"],
            },
          },
        ],
      );

      expect(mocks.videosInsert).toHaveBeenCalledWith(
        expect.objectContaining({
          part: expect.arrayContaining(["id", "snippet", "status"]),
          requestBody: expect.objectContaining({
            snippet: expect.objectContaining({
              title: "My Title",
              description: "Description text",
              tags: ["tag1", "tag2"],
            }),
            status: expect.objectContaining({
              privacyStatus: "unlisted",
            }),
          }),
        }),
      );
    });

    it("maps normalized Publishing Settings into YouTube status metadata", async () => {
      mockFetch.mockResolvedValue(videoFetchResponse());
      mocks.videosInsert.mockResolvedValue({ data: { id: "abc123" } });

      await youTubeProvider.post(
        "uid",
        FAKE_ACCESS_TOKEN,
        [
          {
            postId: "p1",
            content: "Description text",
            media: [{ type: "video", url: "https://example.com/v.mp4" }],
            platformSettings: {
              title: "My Title",
              privacyStatus: "private",
              madeForKids: true,
              tags: ["launch", "demo"],
            },
          },
        ],
      );

      expect(mocks.videosInsert).toHaveBeenCalledWith(
        expect.objectContaining({
          requestBody: expect.objectContaining({
            snippet: expect.objectContaining({
              title: "My Title",
              tags: ["launch", "demo"],
            }),
            status: expect.objectContaining({
              privacyStatus: "private",
              selfDeclaredMadeForKids: true,
            }),
          }),
        }),
      );
    });

    it("uses content as description and first 100 chars as title if no title given", async () => {
      mockFetch.mockResolvedValue(videoFetchResponse());
      mocks.videosInsert.mockResolvedValue({ data: { id: "xyz" } });

      const content = "This is a long description for a video";

      await youTubeProvider.post(
        "uid",
        FAKE_ACCESS_TOKEN,
        [
          {
            postId: "p1",
            content,
            media: [{ type: "video", url: "https://example.com/v.mp4" }],
          },
        ],
      );

      const callArgs = mocks.videosInsert.mock.calls[0][0];
      expect(callArgs.requestBody.snippet.title).toBe(content.slice(0, 100));
      expect(callArgs.requestBody.snippet.description).toBe(content);
    });

    it("throws when no video media item is provided", async () => {
      await expect(
        youTubeProvider.post(
          "uid",
          FAKE_ACCESS_TOKEN,
          [
            {
              postId: "p1",
              content: "No video",
              media: [{ type: "image", url: "https://example.com/img.jpg" }],
            },
          ],
        ),
      ).rejects.toThrow("YouTube requires exactly one video media item");
    });

    it("uploads a thumbnail when thumbnailUrl is provided in platformSettings", async () => {
      mockFetch.mockResolvedValue(videoFetchResponse());
      mocks.videosInsert.mockResolvedValue({ data: { id: "vid-with-thumb" } });
      mocks.thumbnailsSet.mockResolvedValue({});

      await youTubeProvider.post(
        "uid",
        FAKE_ACCESS_TOKEN,
        [
          {
            postId: "p1",
            content: "Video with thumbnail",
            media: [{ type: "video", url: "https://example.com/v.mp4" }],
            platformSettings: {
              title: "Title",
              thumbnailUrl: "https://example.com/thumb.jpg",
            },
          },
        ],
      );

      expect(mocks.thumbnailsSet).toHaveBeenCalledWith(
        expect.objectContaining({ videoId: "vid-with-thumb" }),
      );
    });

    it("continues if thumbnail upload fails (best-effort)", async () => {
      mockFetch.mockResolvedValue(videoFetchResponse());
      mocks.videosInsert.mockResolvedValue({ data: { id: "vid-no-thumb" } });
      mocks.thumbnailsSet.mockRejectedValue(new Error("failedPrecondition"));

      // Should not throw — thumbnail failure is non-fatal
      const results = await youTubeProvider.post(
        "uid",
        FAKE_ACCESS_TOKEN,
        [
          {
            postId: "p1",
            content: "Test",
            media: [{ type: "video", url: "https://example.com/v.mp4" }],
            platformSettings: {
              thumbnailUrl: "https://example.com/thumb.jpg",
            },
          },
        ],
      );

      expect(results[0].platformPostId).toBe("vid-no-thumb");
      expect(results[0].status).toBe("published");
    });
  });

  // -------------------------------------------------------------------------
  // classifyError
  // -------------------------------------------------------------------------

  describe("classifyError", () => {
    it("classifies Unauthorized as refresh-token", () => {
      const err = new Error("Unauthorized access");
      expect(youTubeProvider.classifyError(err).type).toBe("refresh-token");
    });

    it("classifies UNAUTHENTICATED as refresh-token", () => {
      const err = new Error("UNAUTHENTICATED: token expired");
      expect(youTubeProvider.classifyError(err).type).toBe("refresh-token");
    });

    it("classifies invalid_grant as refresh-token", () => {
      const err = new Error("invalid_grant: token has been expired");
      expect(youTubeProvider.classifyError(err).type).toBe("refresh-token");
    });

    it("classifies invalidTitle as bad-body", () => {
      const err = new Error("YouTube videos.insert failed: 400 invalidTitle");
      expect(youTubeProvider.classifyError(err).type).toBe("bad-body");
    });

    it("classifies youtubeSignupRequired as bad-body", () => {
      const err = new Error("youtubeSignupRequired: link your account");
      expect(youTubeProvider.classifyError(err).type).toBe("bad-body");
    });

    it("classifies uploadLimitExceeded as bad-body", () => {
      const err = new Error("uploadLimitExceeded daily quota");
      expect(youTubeProvider.classifyError(err).type).toBe("bad-body");
    });

    it("classifies failedPrecondition (thumbnail) as bad-body", () => {
      const err = new Error(
        "youtube.thumbnail failedPrecondition: file too large",
      );
      expect(youTubeProvider.classifyError(err).type).toBe("bad-body");
    });

    it("classifies quotaExceeded as retry", () => {
      const err = new Error("quotaExceeded: API quota limit reached");
      expect(youTubeProvider.classifyError(err).type).toBe("retry");
    });

    it("classifies rateLimitExceeded as retry", () => {
      const err = new Error("rateLimitExceeded");
      expect(youTubeProvider.classifyError(err).type).toBe("retry");
    });

    it("classifies unknown errors as retry", () => {
      const err = new Error("Some transient network error");
      expect(youTubeProvider.classifyError(err).type).toBe("retry");
    });

    it("includes the original error in the result", () => {
      const err = new Error("some error");
      const classified = youTubeProvider.classifyError(err);
      expect(classified.original).toBe(err);
    });
  });

  // -------------------------------------------------------------------------
  // getCapabilities
  // -------------------------------------------------------------------------

  describe("getCapabilities", () => {
    it("returns the expected YouTube capabilities", () => {
      const caps = youTubeProvider.getCapabilities();
      expect(caps.identifier).toBe("youtube");
      expect(caps.displayName).toBe("YouTube");
      expect(caps.supportsImages).toBe(false);
      expect(caps.supportsVideo).toBe(true);
      expect(caps.supportsCarousel).toBe(false);
      expect(caps.requiresPageSelection).toBe(true);
      expect(caps.maxContentLength).toBe(5000);
    });
  });
});
