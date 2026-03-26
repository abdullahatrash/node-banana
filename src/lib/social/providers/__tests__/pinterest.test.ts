import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearRegistry } from "@/lib/social/provider-registry";
import { pinterestProvider } from "@/lib/social/providers/pinterest";

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

describe("pinterestProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearRegistry();
    process.env.PINTEREST_CLIENT_ID = "pin-client-id";
    process.env.PINTEREST_CLIENT_SECRET = "pin-client-secret";
  });

  afterEach(() => {
    delete process.env.PINTEREST_CLIENT_ID;
    delete process.env.PINTEREST_CLIENT_SECRET;
  });

  describe("generateAuthUrl", () => {
    it("builds OAuth url with expected scopes", async () => {
      const result = await pinterestProvider.generateAuthUrl(
        "https://app.example.com/callback/pinterest",
      );

      expect(result.url).toContain("pinterest.com/oauth");
      expect(result.url).toContain("pins%3Awrite");
      expect(result.url).toContain("user_accounts%3Aread");
      expect(result.state).toBeTruthy();
    });
  });

  describe("authenticate", () => {
    it("exchanges code and fetches account info", async () => {
      mockFetch
        .mockResolvedValueOnce(
          mockFetchOk({
            access_token: "pin-access",
            refresh_token: "pin-refresh",
            expires_in: 3600,
          }),
        )
        .mockResolvedValueOnce(
          mockFetchOk({
            id: "pin-user-1",
            username: "pinuser",
            profile_image: "https://example.com/avatar.jpg",
          }),
        );

      const result = await pinterestProvider.authenticate({
        code: "oauth-code",
        state: "oauth-state",
        redirectUri: "https://app.example.com/callback/pinterest",
      });

      expect(result.platformUserId).toBe("pin-user-1");
      expect(result.accessToken).toBe("pin-access");
      expect(result.refreshToken).toBe("pin-refresh");
      expect(result.username).toBe("pinuser");
      expect(result.requiresPageSelection).toBe(false);
    });

    it("throws on token exchange failure", async () => {
      mockFetch.mockResolvedValueOnce(mockFetchError(401, "unauthorized"));
      await expect(
        pinterestProvider.authenticate({
          code: "oauth-code",
          state: "oauth-state",
          redirectUri: "https://app.example.com/callback/pinterest",
        }),
      ).rejects.toThrow("Pinterest token exchange failed: 401");
    });
  });

  describe("refreshToken", () => {
    it("refreshes token", async () => {
      mockFetch.mockResolvedValueOnce(
        mockFetchOk({
          access_token: "pin-access-2",
          expires_in: 7200,
        }),
      );

      const result = await pinterestProvider.refreshToken("pin-refresh");
      expect(result.accessToken).toBe("pin-access-2");
      expect(result.refreshToken).toBe("pin-refresh");
    });
  });

  describe("post", () => {
    it("creates a pin with board and image", async () => {
      mockFetch.mockResolvedValueOnce(
        mockFetchOk({
          id: "pin_123",
        }),
      );

      const results = await pinterestProvider.post("user", "access-token", [
        {
          postId: "spost_1",
          content: "A pretty pin",
          media: [{ type: "image", url: "https://cdn.example.com/img.jpg" }],
          platformSettings: {
            boardId: "board_1",
            title: "Pretty Pin",
            link: "https://example.com/article",
          },
        },
      ]);

      expect(results).toHaveLength(1);
      expect(results[0].status).toBe("published");
      expect(results[0].platformPostId).toBe("pin_123");
      expect(results[0].platformPostUrl).toContain("pinterest.com/pin/pin_123");

      const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
      expect(body.board_id).toBe("board_1");
      expect(body.media_source.source_type).toBe("image_url");
    });

    it("throws when boardId is missing", async () => {
      await expect(
        pinterestProvider.post("user", "access-token", [
          {
            postId: "spost_1",
            content: "A pretty pin",
            media: [{ type: "image", url: "https://cdn.example.com/img.jpg" }],
            platformSettings: {},
          },
        ]),
      ).rejects.toThrow("platformSettings.boardId");
    });

    it("throws when media is missing", async () => {
      await expect(
        pinterestProvider.post("user", "access-token", [
          {
            postId: "spost_1",
            content: "A pretty pin",
            platformSettings: { boardId: "board_1" },
          },
        ]),
      ).rejects.toThrow("requires one image");
    });
  });

  describe("classifyError", () => {
    it("maps auth errors to refresh-token", () => {
      expect(
        pinterestProvider.classifyError(new Error("401 Unauthorized")).type,
      ).toBe("refresh-token");
    });

    it("maps validation errors to bad-body", () => {
      expect(
        pinterestProvider.classifyError(new Error("400 board validation error")).type,
      ).toBe("bad-body");
    });

    it("maps rate-limit errors to retry", () => {
      expect(
        pinterestProvider.classifyError(new Error("429 rate limit")).type,
      ).toBe("retry");
    });
  });
});
