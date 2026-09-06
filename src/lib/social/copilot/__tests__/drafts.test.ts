import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockListSocialAccounts,
  mockCreateSocialPost,
  mockListSocialPosts,
  mockGetSocialPost,
  mockUpdateSocialPost,
  mockDeleteSocialPost,
} = vi.hoisted(() => ({
  mockListSocialAccounts: vi.fn(),
  mockCreateSocialPost: vi.fn(),
  mockListSocialPosts: vi.fn(),
  mockGetSocialPost: vi.fn(),
  mockUpdateSocialPost: vi.fn(),
  mockDeleteSocialPost: vi.fn(),
}));

vi.mock("@/lib/social/repository", () => ({
  listSocialAccounts: mockListSocialAccounts,
  createSocialPost: mockCreateSocialPost,
  listSocialPosts: mockListSocialPosts,
  getSocialPost: mockGetSocialPost,
  updateSocialPost: mockUpdateSocialPost,
  deleteSocialPost: mockDeleteSocialPost,
}));

import {
  createDrafts,
  listDraftsForWorkspace,
  getDraftForWorkspace,
  updateDraftForWorkspace,
  listScheduledPostsForWorkspace,
  duplicateDraftForWorkspace,
  deleteDraftForWorkspace,
} from "../drafts";

const ctx = { workspaceId: "ws_1", userId: "u_1" };

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

describe("listScheduledPostsForWorkspace", () => {
  it("returns non-draft posts in the date range as calendar entries", async () => {
    mockListSocialPosts.mockResolvedValue([
      {
        id: "spost_q",
        socialAccountId: "ch_x",
        status: "queued",
        content: "scheduled one",
        scheduledAt: new Date("2026-06-01T10:00:00.000Z"),
      },
      {
        id: "spost_d",
        socialAccountId: "ch_x",
        status: "draft",
        content: "just a draft",
        scheduledAt: null,
      },
    ]);

    const entries = await listScheduledPostsForWorkspace(ctx, {
      start: "2026-06-01T00:00:00.000Z",
      end: "2026-06-07T00:00:00.000Z",
    });

    expect(mockListSocialPosts).toHaveBeenCalledWith(
      "ws_1",
      expect.objectContaining({
        startDate: expect.any(Date),
        endDate: expect.any(Date),
      }),
    );
    expect(entries.map((e) => e.postId)).toEqual(["spost_q"]);
    expect(entries[0]).toMatchObject({
      channelId: "ch_x",
      status: "queued",
      scheduledAt: "2026-06-01T10:00:00.000Z",
    });
  });
});

describe("duplicateDraftForWorkspace", () => {
  it("clones content/media/settings into a new draft, retargeting the channel when given", async () => {
    mockGetSocialPost.mockResolvedValue({
      id: "spost_1",
      socialAccountId: "ch_x",
      status: "draft",
      content: "hello",
      mediaUrls: [{ type: "image", url: "key.png" }],
      platformSettings: { subreddit: "r/test" },
      scheduledAt: null,
    });
    mockCreateSocialPost.mockImplementation(async (input: Record<string, unknown>) => ({
      id: "spost_2",
      socialAccountId: input.socialAccountId,
      status: "draft",
      content: input.content ?? null,
      scheduledAt: null,
    }));

    const draft = await duplicateDraftForWorkspace(ctx, "spost_1", {
      channelId: "ch_li",
    });

    expect(mockGetSocialPost).toHaveBeenCalledWith("ws_1", "spost_1");
    expect(mockCreateSocialPost).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "ws_1",
        createdByUserId: "u_1",
        socialAccountId: "ch_li",
        content: "hello",
        mediaUrls: [{ type: "image", url: "key.png" }],
        platformSettings: { subreddit: "r/test" },
      }),
    );
    expect(draft.id).toBe("spost_2");
  });

  it("duplicates a legacy text-only draft when optional media arrays are absent", async () => {
    mockGetSocialPost.mockResolvedValue({ id: "spost_legacy", socialAccountId: "ch_x", status: "draft", content: "legacy", scheduledAt: null });
    await expect(duplicateDraftForWorkspace(ctx, "spost_legacy")).resolves.toMatchObject({ status: "draft" });
    expect(mockCreateSocialPost).toHaveBeenCalledWith(expect.not.objectContaining({ mediaReferences: expect.anything() }));
  });
});

describe("deleteDraftForWorkspace", () => {
  it("deletes a draft scoped to the workspace", async () => {
    mockDeleteSocialPost.mockResolvedValue(undefined);

    const result = await deleteDraftForWorkspace(ctx, "spost_1");

    expect(mockDeleteSocialPost).toHaveBeenCalledWith("ws_1", "spost_1");
    expect(result).toEqual({ postId: "spost_1", deleted: true });
  });
});

describe("updateDraftForWorkspace", () => {
  it("updates content/settings/schedule scoped to the workspace, converting schedule to a Date", async () => {
    mockUpdateSocialPost.mockResolvedValue({
      id: "spost_1",
      socialAccountId: "ch_x",
      status: "draft",
      content: "new text",
      scheduledAt: new Date("2026-06-01T10:00:00.000Z"),
    });

    const draft = await updateDraftForWorkspace(
      { workspaceId: "ws_1", userId: "u_1" },
      "spost_1",
      { content: "new text", scheduledAt: "2026-06-01T10:00:00.000Z" },
    );

    expect(mockUpdateSocialPost).toHaveBeenCalledWith(
      "ws_1",
      "spost_1",
      expect.objectContaining({ content: "new text" }),
    );
    expect(mockUpdateSocialPost.mock.calls[0][2].scheduledAt).toBeInstanceOf(Date);
    expect(draft.content).toBe("new text");
    expect(draft.scheduledAt).toBe("2026-06-01T10:00:00.000Z");
  });
});
