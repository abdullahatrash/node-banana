import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearRegistry } from "@/lib/social/provider-registry";
import { redditProvider } from "@/lib/social/providers/reddit";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function mockFetchOk(body: unknown) {
  return {
    ok: true,
    status: 200,
    json: vi.fn().mockResolvedValue(body),
    text: vi.fn().mockResolvedValue(JSON.stringify(body)),
  };
}

function mockFetchError(status: number, body = "error") {
  return {
    ok: false,
    status,
    json: vi.fn().mockResolvedValue({}),
    text: vi.fn().mockResolvedValue(body),
  };
}

describe("redditProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearRegistry();
    process.env.REDDIT_CLIENT_ID = "reddit-client-id";
    process.env.REDDIT_CLIENT_SECRET = "reddit-client-secret";
    process.env.REDDIT_USER_AGENT = "nodebanana-test/1.0";
  });

  afterEach(() => {
    delete process.env.REDDIT_CLIENT_ID;
    delete process.env.REDDIT_CLIENT_SECRET;
    delete process.env.REDDIT_USER_AGENT;
  });

  describe("generateAuthUrl", () => {
    it("builds authorize url with identity and submit scopes", async () => {
      const result = await redditProvider.generateAuthUrl("https://app.example.com/callback");
      expect(result.url).toContain("reddit.com/api/v1/authorize");
      expect(result.url).toContain("scope=identity+submit+read");
      expect(result.state).toBeTruthy();
    });
  });

  describe("authenticate", () => {
    it("exchanges code and returns profile", async () => {
      mockFetch
        .mockResolvedValueOnce(
          mockFetchOk({
            access_token: "reddit-access",
            refresh_token: "reddit-refresh",
            expires_in: 3600,
          }),
        )
        .mockResolvedValueOnce(
          mockFetchOk({
            id: "t2_123",
            name: "reddit_user",
            icon_img: "https://example.com/avatar.png",
          }),
        );

      const result = await redditProvider.authenticate({
        code: "oauth-code",
        state: "state",
        redirectUri: "https://app.example.com/callback",
      });

      expect(result.platformUserId).toBe("t2_123");
      expect(result.username).toBe("reddit_user");
      expect(result.accessToken).toBe("reddit-access");
      expect(result.refreshToken).toBe("reddit-refresh");
      expect(result.requiresPageSelection).toBe(false);
    });

    it("throws on token exchange failure", async () => {
      mockFetch.mockResolvedValueOnce(mockFetchError(401, "bad auth"));

      await expect(
        redditProvider.authenticate({
          code: "oauth-code",
          state: "state",
          redirectUri: "https://app.example.com/callback",
        }),
      ).rejects.toThrow("Reddit token exchange failed: 401");
    });
  });

  describe("refreshToken", () => {
    it("refreshes access token", async () => {
      mockFetch.mockResolvedValueOnce(
        mockFetchOk({
          access_token: "new-access-token",
          expires_in: 3600,
        }),
      );

      const result = await redditProvider.refreshToken("refresh-token");
      expect(result.accessToken).toBe("new-access-token");
      expect(result.refreshToken).toBe("refresh-token");
      expect(result.expiresIn).toBe(3600);
    });
  });

  describe("post", () => {
    it("creates a self post", async () => {
      mockFetch.mockResolvedValueOnce(
        mockFetchOk({
          json: {
            errors: [],
            data: {
              name: "t3_abc",
              url: "https://www.reddit.com/r/test/comments/abc/post",
            },
          },
        }),
      );

      const results = await redditProvider.post("user", "access-token", [
        {
          postId: "spost_1",
          content: "Hello from node banana",
          platformSettings: {
            subreddit: "test",
            title: "My Post Title",
          },
        },
      ]);

      expect(results).toHaveLength(1);
      expect(results[0].status).toBe("published");
      expect(results[0].platformPostId).toBe("t3_abc");
      expect(results[0].platformPostUrl).toContain("/r/test/");

      const body = new URLSearchParams(
        mockFetch.mock.calls[0][1].body as string,
      );
      expect(body.get("kind")).toBe("self");
      expect(body.get("sr")).toBe("test");
      expect(body.get("title")).toBe("My Post Title");
    });

    it("creates a link post when link setting is provided", async () => {
      mockFetch.mockResolvedValueOnce(
        mockFetchOk({
          json: { errors: [], data: { name: "t3_link" } },
        }),
      );

      await redditProvider.post("user", "access-token", [
        {
          postId: "spost_2",
          content: "Link post",
          platformSettings: {
            subreddit: "test",
            link: "https://example.com/article",
            title: "Interesting read",
          },
        },
      ]);

      const body = new URLSearchParams(
        mockFetch.mock.calls[0][1].body as string,
      );
      expect(body.get("kind")).toBe("link");
      expect(body.get("url")).toBe("https://example.com/article");
    });

    it("creates a link post from normalized Publishing Settings", async () => {
      mockFetch.mockResolvedValueOnce(
        mockFetchOk({
          json: { errors: [], data: { name: "t3_link" } },
        }),
      );

      await redditProvider.post("user", "access-token", [
        {
          postId: "spost_2",
          content: "Link post",
          platformSettings: {
            subreddit: "/r/test",
            type: "link",
            url: "https://example.com/article",
            title: "Interesting read",
          },
        },
      ]);

      const body = new URLSearchParams(
        mockFetch.mock.calls[0][1].body as string,
      );
      expect(body.get("kind")).toBe("link");
      expect(body.get("sr")).toBe("test");
      expect(body.get("url")).toBe("https://example.com/article");
      expect(body.get("title")).toBe("Interesting read");
    });

    it("throws when subreddit is missing", async () => {
      await expect(
        redditProvider.post("user", "access-token", [
          {
            postId: "spost_3",
            content: "Missing subreddit",
            platformSettings: {},
          },
        ]),
      ).rejects.toThrow("platformSettings.subreddit");
    });
  });

  describe("classifyError", () => {
    it("classifies auth errors as refresh-token", () => {
      expect(
        redditProvider.classifyError(new Error("401 Unauthorized token expired")).type,
      ).toBe("refresh-token");
    });

    it("classifies validation errors as bad-body", () => {
      expect(
        redditProvider.classifyError(new Error("validation subreddit is required")).type,
      ).toBe("bad-body");
    });

    it("classifies rate-limit errors as retry", () => {
      expect(
        redditProvider.classifyError(new Error("429 rate limit exceeded")).type,
      ).toBe("retry");
    });
  });
});
