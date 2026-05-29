import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockListWorkspaceAssets, mockGetAsset, mockGetSocialPost, mockUpdateSocialPost } =
  vi.hoisted(() => ({
    mockListWorkspaceAssets: vi.fn(),
    mockGetAsset: vi.fn(),
    mockGetSocialPost: vi.fn(),
    mockUpdateSocialPost: vi.fn(),
  }));

vi.mock("@/lib/studio/repository", () => ({
  listWorkspaceAssets: mockListWorkspaceAssets,
  getAsset: mockGetAsset,
}));

vi.mock("@/lib/social/repository", () => ({
  getSocialPost: mockGetSocialPost,
  updateSocialPost: mockUpdateSocialPost,
}));

import { listMediaPoolAssets, attachMedia } from "../media";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("listMediaPoolAssets", () => {
  it("returns workspace assets mapped to the copilot shape, scoped to the workspace", async () => {
    mockListWorkspaceAssets.mockResolvedValue([
      {
        id: "asset_1",
        type: "image",
        mimeType: "image/png",
        storageKey: "ws_1/asset_1.png",
        width: 1024,
        height: 768,
      },
    ]);

    const assets = await listMediaPoolAssets(
      { workspaceId: "ws_1", userId: "u_1" },
      { type: "image", limit: 20 },
    );

    expect(mockListWorkspaceAssets).toHaveBeenCalledWith("ws_1", {
      type: "image",
      limit: 20,
    });
    expect(assets).toEqual([
      {
        id: "asset_1",
        type: "image",
        mimeType: "image/png",
        storageKey: "ws_1/asset_1.png",
        width: 1024,
        height: 768,
      },
    ]);
  });
});

describe("attachMedia", () => {
  it("appends resolved assets to the draft's existing media, scoped to the workspace", async () => {
    mockGetSocialPost.mockResolvedValue({
      id: "spost_1",
      mediaUrls: [{ type: "image", url: "existing/key.png" }],
    });
    mockGetAsset.mockResolvedValue({
      id: "asset_1",
      type: "image",
      storageKey: "ws_1/asset_1.png",
    });
    mockUpdateSocialPost.mockResolvedValue({ id: "spost_1" });

    const result = await attachMedia(
      { workspaceId: "ws_1", userId: "u_1" },
      "spost_1",
      ["asset_1"],
    );

    expect(mockGetSocialPost).toHaveBeenCalledWith("ws_1", "spost_1");
    expect(mockGetAsset).toHaveBeenCalledWith("ws_1", "asset_1");
    expect(mockUpdateSocialPost).toHaveBeenCalledWith("ws_1", "spost_1", {
      mediaUrls: [
        { type: "image", url: "existing/key.png" },
        { type: "image", url: "ws_1/asset_1.png" },
      ],
    });
    expect(result.media).toHaveLength(2);
  });

  it("rejects an asset id that doesn't belong to the workspace and updates nothing", async () => {
    mockGetSocialPost.mockResolvedValue({ id: "spost_1", mediaUrls: null });
    mockGetAsset.mockResolvedValue(null);

    await expect(
      attachMedia({ workspaceId: "ws_1", userId: "u_1" }, "spost_1", ["asset_x"]),
    ).rejects.toThrow(/asset_x/);

    expect(mockUpdateSocialPost).not.toHaveBeenCalled();
  });
});
