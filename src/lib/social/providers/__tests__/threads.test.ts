import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearRegistry } from "@/lib/social/provider-registry";
import { threadsProvider } from "@/lib/social/providers/threads";

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

function mockFetchError(status: number, text = "error") {
  return {
    ok: false,
    status,
    json: vi.fn().mockResolvedValue({}),
    text: vi.fn().mockResolvedValue(text),
  };
}

describe("threadsProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearRegistry();
    process.env.META_APP_ID = "meta-app-id";
    process.env.META_APP_SECRET = "meta-app-secret";
  });

  afterEach(() => {
    delete process.env.META_APP_ID;
    delete process.env.META_APP_SECRET;
  });

  describe("generateAuthUrl", () => {
    it("generates Meta OAuth url with Threads scopes", async () => {
      const result = await threadsProvider.generateAuthUrl(
        "https://app.example.com/social/callback",
      );

      expect(result.url).toContain("facebook.com/v20.0/dialog/oauth");
      expect(result.url).toContain("threads_basic");
      expect(result.url).toContain("threads_content_publish");
      expect(result.state).toBeTruthy();
    });
  });

  describe("authenticate", () => {
    it("exchanges token and returns profile", async () => {
      mockFetch
        // exchangeCodeForToken
        .mockResolvedValueOnce(
          mockFetchOk({
            access_token: "short-token",
            token_type: "bearer",
            expires_in: 300,
          }),
        )
        // exchangeForLongLivedToken
        .mockResolvedValueOnce(
          mockFetchOk({
            access_token: "long-token",
            token_type: "bearer",
            expires_in: 5_097_600,
          }),
        )
        // verifyGrantedScopes
        .mockResolvedValueOnce(
          mockFetchOk({
            data: [
              { permission: "threads_basic", status: "granted" },
              { permission: "threads_content_publish", status: "granted" },
              { permission: "threads_manage_insights", status: "granted" },
              { permission: "pages_show_list", status: "granted" },
              { permission: "business_management", status: "granted" },
            ],
          }),
        )
        // /me profile
        .mockResolvedValueOnce(
          mockFetchOk({
            id: "meta-user-1",
            name: "Threads User",
            picture: { data: { url: "https://example.com/avatar.jpg" } },
          }),
        );

      const result = await threadsProvider.authenticate({
        code: "oauth-code",
        state: "oauth-state",
        redirectUri: "https://app.example.com/social/callback",
      });

      expect(result.platformUserId).toBe("meta-user-1");
      expect(result.accessToken).toBe("long-token");
      expect(result.displayName).toBe("Threads User");
      expect(result.requiresPageSelection).toBe(true);
    });

    it("throws when Meta app env vars are missing", async () => {
      delete process.env.META_APP_ID;
      await expect(
        threadsProvider.generateAuthUrl("https://app.example.com/social/callback"),
      ).rejects.toThrow("META_APP_ID");
    });
  });

  describe("fetchPageInformation", () => {
    it("returns only pages with threads profiles", async () => {
      mockFetch.mockResolvedValueOnce(
        mockFetchOk({
          data: [
            {
              id: "page_1",
              name: "Page One",
              access_token: "page-token-1",
              instagram_business_account: {
                id: "ig_1",
                username: "igone",
                profile_picture_url: "https://example.com/ig.jpg",
                threads_profile: {
                  id: "threads_1",
                  username: "threadone",
                  profile_picture_url: "https://example.com/thread.jpg",
                },
              },
            },
            {
              id: "page_2",
              name: "No Threads",
              access_token: "page-token-2",
              instagram_business_account: {
                id: "ig_2",
                username: "igtwo",
              },
            },
          ],
        }),
      );

      const pages = await threadsProvider.fetchPageInformation?.("user-token");
      expect(pages).toEqual([
        {
          id: "threads_1",
          name: "threadone",
          username: "threadone",
          picture: "https://example.com/thread.jpg",
          accessToken: "page-token-1",
        },
      ]);
    });
  });

  describe("post", () => {
    it("creates and publishes a text post", async () => {
      mockFetch
        // create container
        .mockResolvedValueOnce(mockFetchOk({ id: "creation_1" }))
        // publish
        .mockResolvedValueOnce(mockFetchOk({ id: "threads_post_1" }))
        // permalink
        .mockResolvedValueOnce(
          mockFetchOk({
            id: "threads_post_1",
            permalink: "https://www.threads.net/t/threads_post_1",
          }),
        );

      const results = await threadsProvider.post("threads_user_1", "access-token", [
        {
          postId: "spost_1",
          content: "Hello Threads!",
        },
      ]);

      expect(results).toHaveLength(1);
      expect(results[0].status).toBe("published");
      expect(results[0].platformPostId).toBe("threads_post_1");
      expect(results[0].platformPostUrl).toContain("threads.net");
    });

    it("throws when media is provided", async () => {
      await expect(
        threadsProvider.post("threads_user_1", "access-token", [
          {
            postId: "spost_1",
            content: "Hello Threads!",
            media: [{ type: "image", url: "https://example.com/img.jpg" }],
          },
        ]),
      ).rejects.toThrow("text-only posts");
    });

    it("throws on create error", async () => {
      mockFetch.mockResolvedValueOnce(mockFetchError(400, "bad request"));
      await expect(
        threadsProvider.post("threads_user_1", "access-token", [
          {
            postId: "spost_1",
            content: "Hello Threads!",
          },
        ]),
      ).rejects.toThrow("Failed to create Threads post container");
    });
  });

  describe("classifyError", () => {
    it("classifies Meta token errors as refresh-token", () => {
      const classified = threadsProvider.classifyError(
        new Error("Error validating access token"),
      );
      expect(classified.type).toBe("refresh-token");
    });

    it("falls back to retry for unknown errors", () => {
      const classified = threadsProvider.classifyError(
        new Error("Unknown failure"),
      );
      expect(classified.type).toBe("retry");
    });
  });
});
