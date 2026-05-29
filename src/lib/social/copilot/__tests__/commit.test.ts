import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockValidate, mockUpdatePostStatus } = vi.hoisted(() => ({
  mockValidate: vi.fn(),
  mockUpdatePostStatus: vi.fn(),
}));

vi.mock("../validate", () => ({
  validatePublishForDraft: mockValidate,
}));

vi.mock("@/lib/social/repository", () => ({
  updatePostStatus: mockUpdatePostStatus,
}));

import { scheduleDraftForWorkspace, publishNowForWorkspace } from "../commit";

const ctx = { workspaceId: "ws_1", userId: "u_1" };

beforeEach(() => {
  vi.clearAllMocks();
  mockUpdatePostStatus.mockResolvedValue({ id: "spost_1", status: "queued" });
});

describe("scheduleDraftForWorkspace", () => {
  it("queues a ready draft with the requested schedule", async () => {
    mockValidate.mockResolvedValue({
      postId: "spost_1",
      channelId: "ch_x",
      platform: "bluesky",
      ready: true,
      reasons: [],
    });

    const result = await scheduleDraftForWorkspace(ctx, "spost_1", "2026-06-01T10:00:00.000Z");

    expect(mockValidate).toHaveBeenCalledWith(ctx, "spost_1");
    expect(mockUpdatePostStatus).toHaveBeenCalledWith(
      "spost_1",
      "queued",
      expect.objectContaining({ dispatchStatus: "pending" }),
    );
    expect(mockUpdatePostStatus.mock.calls[0][2].scheduledAt).toBeInstanceOf(Date);
    expect(result).toMatchObject({ postId: "spost_1", scheduledAt: "2026-06-01T10:00:00.000Z" });
  });

  it("refuses to queue an unready draft and changes nothing", async () => {
    mockValidate.mockResolvedValue({
      postId: "spost_1",
      channelId: "ch_yt",
      platform: "youtube",
      ready: false,
      reasons: ["YouTube: title is required."],
    });

    await expect(
      scheduleDraftForWorkspace(ctx, "spost_1", "2026-06-01T10:00:00.000Z"),
    ).rejects.toThrow(/title is required/i);

    expect(mockUpdatePostStatus).not.toHaveBeenCalled();
  });
});

describe("publishNowForWorkspace", () => {
  it("queues a ready draft for immediate publish (no future schedule)", async () => {
    mockValidate.mockResolvedValue({
      postId: "spost_1",
      channelId: "ch_x",
      platform: "bluesky",
      ready: true,
      reasons: [],
    });

    const result = await publishNowForWorkspace(ctx, "spost_1");

    expect(mockUpdatePostStatus).toHaveBeenCalledWith(
      "spost_1",
      "queued",
      expect.objectContaining({ scheduledAt: null, dispatchStatus: "pending" }),
    );
    expect(result).toMatchObject({ postId: "spost_1", scheduledAt: null });
  });

  it("refuses to publish an unready draft and changes nothing", async () => {
    mockValidate.mockResolvedValue({
      postId: "spost_1",
      channelId: "ch_x",
      platform: "bluesky",
      ready: false,
      reasons: ["Post has no content or media."],
    });

    await expect(publishNowForWorkspace(ctx, "spost_1")).rejects.toThrow(/no content/i);
    expect(mockUpdatePostStatus).not.toHaveBeenCalled();
  });
});
