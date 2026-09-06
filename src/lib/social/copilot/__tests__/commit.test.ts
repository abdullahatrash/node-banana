import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockValidate, mockUpdatePostStatus, mockGetPost, mockUpdateSocialPost, mockInspect, mockConsume, mockVerifyConsumed } = vi.hoisted(() => ({
  mockValidate: vi.fn(),
  mockUpdatePostStatus: vi.fn(),
  mockGetPost: vi.fn(),
  mockUpdateSocialPost: vi.fn(),
  mockInspect: vi.fn(),
  mockConsume: vi.fn(),
  mockVerifyConsumed: vi.fn(),
}));

vi.mock("../validate", () => ({
  validatePublishForDraft: mockValidate,
}));

vi.mock("@/lib/social/repository", () => ({
  updatePostStatus: mockUpdatePostStatus,
  getSocialPost: mockGetPost,
  updateSocialPost: mockUpdateSocialPost,
}));
vi.mock("@/lib/agent-tools/social-publishing-approval", async (load) => {
  const actual = await load<typeof import("@/lib/agent-tools/social-publishing-approval")>();
  return { ...actual, PRODUCTION_SOCIAL_PUBLISHING_APPROVAL_ADMISSION: { inspect: mockInspect, consume: mockConsume, verifyConsumed: mockVerifyConsumed } };
});

import { scheduleDraftForWorkspace, publishNowForWorkspace } from "../commit";

const ctx = { workspaceId: "ws_1", userId: "u_1" };
const evidence = { approvalRequestId: "par_1", targetId: "target_1", targetEvidenceDigest: `sha256:${"a".repeat(64)}`, consumingPrincipalId: "u_1", consumingKeyId: "key_1", authorizationEvidenceRef: "auth_1", authorizationIssuedAt: "2026-06-01T09:00:00.000Z", authorizationExpiresAt: "2026-06-01T11:00:00.000Z" };
const approval = { publishingApproval: evidence, idempotencyKey: "stable-key-1" };
function post() { return { id: "spost_1", workspaceId: "ws_1", socialAccountId: "ch_x", status: "draft", content: "Approved", mediaUrls: [], platformSettings: { type: "person" }, scheduledAt: null, triggerSource: null }; }
function inspected(kind: "now" | "scheduled", publishAt: string) { return { requestId: "par_1", decisionId: "dec_1", evidence, channelIds: ["ch_x"], artifactIds: [], target: { targetId: "target_1", targetEvidenceDigest: evidence.targetEvidenceDigest, channel: { id: "ch_x" }, content: { text: "Approved" }, media: [], settings: { type: "person" }, timing: { kind, publishAt } } }; }

beforeEach(() => {
  vi.clearAllMocks();
  mockUpdatePostStatus.mockResolvedValue({ id: "spost_1", status: "queued" });
  mockGetPost.mockResolvedValue(post());
  mockUpdateSocialPost.mockResolvedValue(post());
  mockConsume.mockResolvedValue("consumed");
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

    mockInspect.mockResolvedValue(inspected("scheduled", "2026-06-01T10:00:00.000Z"));
    const result = await scheduleDraftForWorkspace(ctx, "spost_1", "2026-06-01T10:00:00.000Z", approval);

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
      scheduleDraftForWorkspace(ctx, "spost_1", "2026-06-01T10:00:00.000Z", approval),
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

    mockInspect.mockResolvedValue(inspected("now", "2026-06-01T10:00:00.000Z"));
    const result = await publishNowForWorkspace(ctx, "spost_1", approval);

    expect(mockUpdatePostStatus).toHaveBeenCalledWith(
      "spost_1",
      "queued",
      expect.objectContaining({ scheduledAt: expect.any(Date), dispatchStatus: "pending" }),
    );
    expect(result).toMatchObject({ postId: "spost_1", scheduledAt: "2026-06-01T10:00:00.000Z" });
  });

  it("refuses to publish an unready draft and changes nothing", async () => {
    mockValidate.mockResolvedValue({
      postId: "spost_1",
      channelId: "ch_x",
      platform: "bluesky",
      ready: false,
      reasons: ["Post has no content or media."],
    });

    await expect(publishNowForWorkspace(ctx, "spost_1", approval)).rejects.toThrow(/no content/i);
    expect(mockUpdatePostStatus).not.toHaveBeenCalled();
  });
});
