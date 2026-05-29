import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockGetSocialPost,
  mockGetSocialAccount,
  mockGetProvider,
  mockValidateSettings,
} = vi.hoisted(() => ({
  mockGetSocialPost: vi.fn(),
  mockGetSocialAccount: vi.fn(),
  mockGetProvider: vi.fn(),
  mockValidateSettings: vi.fn(),
}));

vi.mock("@/lib/social/repository", () => ({
  getSocialPost: mockGetSocialPost,
  getSocialAccount: mockGetSocialAccount,
}));

vi.mock("@/lib/social/provider-registry", () => ({
  getProvider: mockGetProvider,
}));

vi.mock("@/lib/social/publishing-settings", () => ({
  validateSelectedPublishingSettings: mockValidateSettings,
}));

import { validatePublishForDraft } from "../validate";

beforeEach(() => {
  vi.clearAllMocks();
  mockGetProvider.mockReturnValue({
    getCapabilities: () => ({ displayName: "Bluesky", maxContentLength: 300 }),
  });
  mockValidateSettings.mockReturnValue({ valid: true, errors: [] });
});

describe("validatePublishForDraft", () => {
  it("reports a ready draft with no reasons", async () => {
    mockGetSocialPost.mockResolvedValue({
      socialAccountId: "ch_x",
      content: "hello",
      mediaUrls: null,
      platformSettings: null,
    });
    mockGetSocialAccount.mockResolvedValue({ platform: "bluesky" });

    const readiness = await validatePublishForDraft(
      { workspaceId: "ws_1", userId: "u_1" },
      "spost_1",
    );

    expect(mockGetSocialPost).toHaveBeenCalledWith("ws_1", "spost_1");
    expect(readiness).toEqual({
      postId: "spost_1",
      channelId: "ch_x",
      platform: "bluesky",
      ready: true,
      reasons: [],
    });
  });

  it("flags content that exceeds the platform's max length", async () => {
    mockGetSocialPost.mockResolvedValue({
      socialAccountId: "ch_x",
      content: "x".repeat(301),
      mediaUrls: null,
      platformSettings: null,
    });
    mockGetSocialAccount.mockResolvedValue({ platform: "bluesky" });

    const readiness = await validatePublishForDraft(
      { workspaceId: "ws_1", userId: "u_1" },
      "spost_1",
    );

    expect(readiness.ready).toBe(false);
    expect(readiness.reasons.join(" ")).toMatch(/300/);
  });

  it("surfaces publishing-settings errors as reasons", async () => {
    mockGetSocialPost.mockResolvedValue({
      socialAccountId: "ch_yt",
      content: "my video",
      mediaUrls: null,
      platformSettings: {},
    });
    mockGetSocialAccount.mockResolvedValue({ platform: "youtube" });
    mockGetProvider.mockReturnValue({
      getCapabilities: () => ({ displayName: "YouTube", maxContentLength: 5000 }),
    });
    mockValidateSettings.mockReturnValue({
      valid: false,
      errors: ["YouTube: title is required."],
    });

    const readiness = await validatePublishForDraft(
      { workspaceId: "ws_1", userId: "u_1" },
      "spost_2",
    );

    expect(mockValidateSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        selectedChannelIds: ["ch_yt"],
        platformByChannelId: { ch_yt: "youtube" },
        content: "my video",
      }),
    );
    expect(readiness.ready).toBe(false);
    expect(readiness.reasons).toContain("YouTube: title is required.");
  });
});
