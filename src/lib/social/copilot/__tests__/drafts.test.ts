import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockListSocialAccounts,
  mockCreateSocialPost,
  mockListSocialPosts,
  mockGetSocialPost,
} = vi.hoisted(() => ({
  mockListSocialAccounts: vi.fn(),
  mockCreateSocialPost: vi.fn(),
  mockListSocialPosts: vi.fn(),
  mockGetSocialPost: vi.fn(),
}));

vi.mock("@/lib/social/repository", () => ({
  listSocialAccounts: mockListSocialAccounts,
  createSocialPost: mockCreateSocialPost,
  listSocialPosts: mockListSocialPosts,
  getSocialPost: mockGetSocialPost,
}));

import { createDrafts, listDraftsForWorkspace, getDraftForWorkspace } from "../drafts";

beforeEach(() => {
  vi.clearAllMocks();
  mockCreateSocialPost.mockImplementation(async (input: Record<string, unknown>) => ({
    id: `spost_${input.socialAccountId}`,
    socialAccountId: input.socialAccountId,
    status: "draft",
    content: input.content ?? null,
    scheduledAt: null,
  }));
});

describe("createDrafts", () => {
  it("creates one draft row per selected channel, scoped to the workspace", async () => {
    mockListSocialAccounts.mockResolvedValue([{ id: "ch_x" }, { id: "ch_li" }]);

    const drafts = await createDrafts(
      { workspaceId: "ws_1", userId: "u_1" },
      { content: "hello world", channelIds: ["ch_x", "ch_li"] },
    );

    expect(mockCreateSocialPost).toHaveBeenCalledTimes(2);
    expect(mockCreateSocialPost).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "ws_1",
        createdByUserId: "u_1",
        socialAccountId: "ch_x",
        content: "hello world",
      }),
    );
    expect(drafts.map((d) => d.socialAccountId)).toEqual(["ch_x", "ch_li"]);
    expect(drafts.every((d) => d.status === "draft")).toBe(true);
  });

  it("rejects channel ids that don't belong to the workspace and creates nothing", async () => {
    mockListSocialAccounts.mockResolvedValue([{ id: "ch_x" }]);

    await expect(
      createDrafts(
        { workspaceId: "ws_1", userId: "u_1" },
        { content: "hi", channelIds: ["ch_x", "ch_other"] },
      ),
    ).rejects.toThrow(/ch_other/);

    expect(mockCreateSocialPost).not.toHaveBeenCalled();
  });
});

describe("listDraftsForWorkspace", () => {
  it("returns only draft-status posts for the workspace", async () => {
    mockListSocialPosts.mockResolvedValue([
      { id: "spost_1", socialAccountId: "ch_x", status: "draft", content: "a", scheduledAt: null },
    ]);

    const drafts = await listDraftsForWorkspace({ workspaceId: "ws_1", userId: "u_1" });

    expect(mockListSocialPosts).toHaveBeenCalledWith(
      "ws_1",
      expect.objectContaining({ status: "draft" }),
    );
    expect(drafts.map((d) => d.id)).toEqual(["spost_1"]);
  });
});

describe("getDraftForWorkspace", () => {
  it("fetches a draft scoped to the workspace", async () => {
    mockGetSocialPost.mockResolvedValue({
      id: "spost_1",
      socialAccountId: "ch_x",
      status: "draft",
      content: "a",
      scheduledAt: null,
    });

    const draft = await getDraftForWorkspace({ workspaceId: "ws_1", userId: "u_1" }, "spost_1");

    expect(mockGetSocialPost).toHaveBeenCalledWith("ws_1", "spost_1");
    expect(draft.id).toBe("spost_1");
  });
});
