import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockListSocialAccounts, mockGetProvider } = vi.hoisted(() => ({
  mockListSocialAccounts: vi.fn(),
  mockGetProvider: vi.fn(),
}));

vi.mock("@/lib/social/repository", () => ({
  listSocialAccounts: mockListSocialAccounts,
}));

vi.mock("@/lib/social/provider-registry", () => ({
  getProvider: mockGetProvider,
}));

import { listChannelsForWorkspace } from "../channels";

function blueskyAdapterStub() {
  return {
    maxImages: 4,
    getCapabilities: () => ({
      identifier: "bluesky" as const,
      displayName: "Bluesky",
      maxContentLength: 300,
      supportsImages: true,
      supportsVideo: false,
      supportsCarousel: false,
      requiresPageSelection: false,
    }),
  };
}

function accountRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "acc_1",
    workspaceId: "ws_1",
    platform: "bluesky",
    displayName: "My Handle",
    username: "me.bsky.social",
    avatarUrl: "https://cdn.example/a.png",
    requiresReauth: false,
    disabled: false,
    accessTokenEncrypted: "enc-access",
    refreshTokenEncrypted: "enc-refresh",
    accessTokenSecret: "enc-secret",
    ...overrides,
  };
}

describe("listChannelsForWorkspace", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns workspace channels with provider capabilities merged and tokens stripped", async () => {
    mockListSocialAccounts.mockResolvedValue([accountRow()]);
    mockGetProvider.mockReturnValue(blueskyAdapterStub());

    const channels = await listChannelsForWorkspace({
      workspaceId: "ws_1",
      userId: "u_1",
    });

    expect(mockListSocialAccounts).toHaveBeenCalledWith("ws_1");
    expect(channels).toHaveLength(1);

    const channel = channels[0];
    expect(channel).toMatchObject({
      id: "acc_1",
      platform: "bluesky",
      displayName: "My Handle",
      username: "me.bsky.social",
      avatarUrl: "https://cdn.example/a.png",
      requiresReauth: false,
      disabled: false,
      capabilities: {
        maxContentLength: 300,
        supportsImages: true,
        supportsVideo: false,
        supportsCarousel: false,
        maxImages: 4,
        requiresPageSelection: false,
      },
    });

    expect(channel).not.toHaveProperty("accessTokenEncrypted");
    expect(channel).not.toHaveProperty("refreshTokenEncrypted");
    expect(channel).not.toHaveProperty("accessTokenSecret");
  });

  it("surfaces disabled and re-auth-needed channels rather than hiding them", async () => {
    mockListSocialAccounts.mockResolvedValue([
      accountRow({ id: "acc_ok", requiresReauth: false, disabled: false }),
      accountRow({ id: "acc_dead", requiresReauth: true, disabled: true }),
    ]);
    mockGetProvider.mockReturnValue(blueskyAdapterStub());

    const channels = await listChannelsForWorkspace({
      workspaceId: "ws_1",
      userId: "u_1",
    });

    expect(channels.map((c) => c.id)).toEqual(["acc_ok", "acc_dead"]);
    expect(channels.find((c) => c.id === "acc_dead")).toMatchObject({
      requiresReauth: true,
      disabled: true,
    });
  });
});
