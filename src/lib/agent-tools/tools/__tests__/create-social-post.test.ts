import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ContentOSSession } from "@/lib/studio/authz";
import { getPermissionsForRole } from "@/lib/studio/authz";

const {
  mockGetSocialAccount,
  mockCreateSocialPost,
  mockUpdatePostStatus,
  mockCountSocialPostsCreatedInRange,
  MockSocialAccountNotFoundError,
  mockGetAsset,
  mockBuildCdnDownloadUrl,
  mockCreatePresignedDownload,
  mockEmitSocialEvent,
  mockValidatePublishingSettings,
  mockInspectPublishingApproval,
  mockConsumePublishingApproval,
} = vi.hoisted(() => {
  class MockSocialAccountNotFoundError extends Error {
    constructor(accountId: string) {
      super(`Social account not found: ${accountId}`);
      this.name = "SocialAccountNotFoundError";
    }
  }
  return {
    mockGetSocialAccount: vi.fn(),
    mockCreateSocialPost: vi.fn(),
    mockUpdatePostStatus: vi.fn(),
    mockCountSocialPostsCreatedInRange: vi.fn(),
    MockSocialAccountNotFoundError,
    mockGetAsset: vi.fn(),
    mockBuildCdnDownloadUrl: vi.fn(),
    mockCreatePresignedDownload: vi.fn(),
    mockEmitSocialEvent: vi.fn(),
    mockValidatePublishingSettings: vi.fn(),
    mockInspectPublishingApproval: vi.fn(),
    mockConsumePublishingApproval: vi.fn(),
  };
});

vi.mock("@/lib/social/repository", () => ({
  getSocialAccount: (...args: unknown[]) => mockGetSocialAccount(...args),
  createSocialPost: (...args: unknown[]) => mockCreateSocialPost(...args),
  updatePostStatus: (...args: unknown[]) => mockUpdatePostStatus(...args),
  countSocialPostsCreatedInRange: (...args: unknown[]) =>
    mockCountSocialPostsCreatedInRange(...args),
  SocialAccountNotFoundError: MockSocialAccountNotFoundError,
}));

vi.mock("@/lib/studio/repository", () => ({
  getAsset: (...args: unknown[]) => mockGetAsset(...args),
}));

vi.mock("@/lib/storage", () => ({
  buildCdnDownloadUrl: (...args: unknown[]) => mockBuildCdnDownloadUrl(...args),
  createPresignedDownload: (...args: unknown[]) =>
    mockCreatePresignedDownload(...args),
}));

vi.mock("@/lib/social/events", () => ({
  emitSocialEvent: (...args: unknown[]) => mockEmitSocialEvent(...args),
}));

vi.mock("@/lib/social/publishing-settings", () => ({
  validateSelectedPublishingSettings: (...args: unknown[]) =>
    mockValidatePublishingSettings(...args),
}));

vi.mock("@/lib/agent-tools/social-publishing-approval", () => ({
    exactApprovedSocialPostInput: () => true,
    PRODUCTION_SOCIAL_PUBLISHING_APPROVAL_ADMISSION: {
      inspect: (...args: unknown[]) => mockInspectPublishingApproval(...args),
      consume: (...args: unknown[]) => mockConsumePublishingApproval(...args),
    },
}));

import { runTool } from "../../runtime";
import { createSocialPostTool } from "../create-social-post";

function session(
  role: "owner" | "member" = "owner",
  workspaceId = "ws_1",
): ContentOSSession {
  return {
    user: { id: `apitoken:${workspaceId}`, name: null, email: null },
    workspace: { id: workspaceId, organizationId: null },
    role,
    planTier: "free",
    permissions: getPermissionsForRole(role),
  };
}

function account(overrides: Record<string, unknown> = {}) {
  return {
    id: "sacct_x",
    workspaceId: "ws_1",
    platform: "x",
    displayName: "Acme on X",
    disabled: false,
    requiresReauth: false,
    ...overrides,
  };
}

function draftRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "spost_1",
    workspaceId: "ws_1",
    socialAccountId: "sacct_x",
    status: "draft",
    scheduledAt: null,
    ...overrides,
  };
}

function approvalEvidence() {
  return {
    approvalRequestId: "par_approved",
    targetId: "target_x",
    targetEvidenceDigest: `sha256:${"a".repeat(64)}`,
    consumingPrincipalId: "principal_agent",
    consumingKeyId: "key_agent",
    authorizationEvidenceRef: "authz-agent-release",
    authorizationIssuedAt: "2026-07-10T14:00:00.000Z",
    authorizationExpiresAt: "2026-07-10T16:00:00.000Z",
  };
}

function inspectedApproval() {
  const evidence = approvalEvidence();
  return {
    requestId: evidence.approvalRequestId,
    decisionId: "pad_approved",
    channelIds: ["sacct_x"],
    artifactIds: ["artifact_text"],
    evidence,
    target: {
      targetId: evidence.targetId,
      channel: { id: "sacct_x", platform: "linkedin", authorKind: "person", displayName: "Acme", historical: false },
      content: { artifactId: "artifact_text", digest: `sha256:${"b".repeat(64)}`, mediaType: "text/plain; charset=utf-8", text: "Scheduled hello" },
      media: [],
      settings: { type: "person" },
      timing: { kind: "scheduled", publishAt: "2026-07-10T15:00:00.000Z" },
      targetEvidenceDigest: evidence.targetEvidenceDigest,
      validation: {},
      costContext: null,
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetSocialAccount.mockResolvedValue(account());
  mockCountSocialPostsCreatedInRange.mockResolvedValue(0);
  mockCreateSocialPost.mockResolvedValue(draftRow());
  mockValidatePublishingSettings.mockReturnValue({ valid: true, errors: [] });
  mockBuildCdnDownloadUrl.mockReturnValue(null);
  mockCreatePresignedDownload.mockResolvedValue({
    downloadUrl: "https://signed.example/media.png",
    expiresInSeconds: 900,
  });
  mockInspectPublishingApproval.mockResolvedValue(inspectedApproval());
  mockConsumePublishingApproval.mockResolvedValue("consumed");
});

describe("create_social_post tool", () => {
  it("creates a draft without queuing it for dispatch", async () => {
    const result = await runTool(
      createSocialPostTool,
      { socialAccountId: "sacct_x", content: "Hello", draft: true },
      { session: session("owner", "ws_1") },
    );

    expect(mockCreateSocialPost).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "ws_1",
        socialAccountId: "sacct_x",
        content: "Hello",
        createdByUserId: "apitoken:ws_1",
      }),
    );
    expect(mockUpdatePostStatus).not.toHaveBeenCalled();
    expect(result).toEqual({
      postId: "spost_1",
      status: "draft",
      scheduledAt: null,
    });
  });

  it("schedules a post: queues it in the exact state the dispatch cron consumes", async () => {
    mockUpdatePostStatus.mockResolvedValue(
      draftRow({
        status: "queued",
        scheduledAt: new Date("2026-07-10T15:00:00.000Z"),
      }),
    );

    const result = await runTool(
      createSocialPostTool,
      {
        socialAccountId: "sacct_x",
        content: "Scheduled hello",
        scheduledAt: "2026-07-10T15:00:00.000Z",
        publishingApproval: approvalEvidence(),
      },
      { session: session("owner", "ws_1") },
    );

    expect(mockUpdatePostStatus).toHaveBeenCalledWith(
      "spost_1",
      "queued",
      expect.objectContaining({
        scheduledAt: new Date("2026-07-10T15:00:00.000Z"),
        dispatchStatus: "pending",
        workflowRunRef: null,
        nextDispatchAt: null,
        lastDispatchError: null,
        errorMessage: null,
        lockedAt: null,
      }),
    );
    expect(mockEmitSocialEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "ws_1",
        eventType: "post.queued",
        postId: "spost_1",
        accountId: "sacct_x",
      }),
    );
    expect(result).toEqual({
      postId: "spost_1",
      status: "queued",
      scheduledAt: "2026-07-10T15:00:00.000Z",
    });
  });

  it("publishes now when neither draft nor scheduledAt is given", async () => {
    mockUpdatePostStatus.mockImplementation(
      async (_id: string, _status: string, extra: { scheduledAt: Date }) =>
        draftRow({ status: "queued", scheduledAt: extra.scheduledAt }),
    );

    const result = await runTool(
      createSocialPostTool,
      { socialAccountId: "sacct_x", content: "Scheduled hello", publishingApproval: approvalEvidence() },
      { session: session("owner", "ws_1") },
    );

    expect(result.status).toBe("queued");
    expect(result.scheduledAt).toBe("2026-07-10T15:00:00.000Z");
    const [, , extra] = mockUpdatePostStatus.mock.calls[0] as [
      string,
      string,
      { scheduledAt: Date; dispatchStatus: string },
    ];
    expect(extra.dispatchStatus).toBe("pending");
    expect(extra.scheduledAt).toBeInstanceOf(Date);
    expect(mockConsumePublishingApproval).toHaveBeenCalledTimes(1);
  });

  it("resolves media asset ids to download URLs and links the studio asset", async () => {
    mockGetAsset.mockResolvedValue({
      id: "asset_1",
      type: "image",
      storageProvider: "s3",
      storageKey: "workspace/ws_1/unscoped/image/pic.png",
      metadata: { uploadState: "ready" },
    });

    await runTool(
      createSocialPostTool,
      {
        socialAccountId: "sacct_x",
        content: "With media",
        mediaAssetIds: ["asset_1"],
        draft: true,
      },
      { session: session("owner", "ws_1") },
    );

    expect(mockGetAsset).toHaveBeenCalledWith("ws_1", "asset_1");
    expect(mockCreateSocialPost).toHaveBeenCalledWith(
      expect.objectContaining({
        mediaUrls: [
          { type: "image", url: "https://signed.example/media.png" },
        ],
        studioAssetId: "asset_1",
      }),
    );
  });

  it("rejects a post with neither content nor media", async () => {
    const error = await runTool(
      createSocialPostTool,
      { socialAccountId: "sacct_x", draft: true },
      { session: session("owner", "ws_1") },
    ).catch((e) => e);

    expect(error.code).toBe("invalid_input");
    expect(mockCreateSocialPost).not.toHaveBeenCalled();
  });

  it("returns not_found when the account is not in this workspace", async () => {
    mockGetSocialAccount.mockRejectedValue(
      new MockSocialAccountNotFoundError("sacct_other"),
    );

    const error = await runTool(
      createSocialPostTool,
      { socialAccountId: "sacct_other", content: "hi", draft: true },
      { session: session("owner", "ws_1") },
    ).catch((e) => e);

    expect(error.code).toBe("not_found");
    expect(mockCreateSocialPost).not.toHaveBeenCalled();
  });

  it("rejects invalid platform settings when queuing (not for drafts)", async () => {
    mockValidatePublishingSettings.mockReturnValue({
      valid: false,
      errors: ["X posts cannot exceed 280 characters."],
    });

    const error = await runTool(
      createSocialPostTool,
      { socialAccountId: "sacct_x", content: "too long", scheduledAt: "2026-07-10T15:00:00.000Z", publishingApproval: approvalEvidence() },
      { session: session("owner", "ws_1") },
    ).catch((e) => e);

    expect(error.code).toBe("invalid_input");
    expect(error.message).toContain("280 characters");
    expect(mockCreateSocialPost).not.toHaveBeenCalled();
  });

  it("does not validate platform settings for a draft", async () => {
    await runTool(
      createSocialPostTool,
      { socialAccountId: "sacct_x", content: "draft", draft: true },
      { session: session("owner", "ws_1") },
    );

    expect(mockValidatePublishingSettings).not.toHaveBeenCalled();
  });

  it("enforces the monthly post quota", async () => {
    mockCountSocialPostsCreatedInRange.mockResolvedValue(50);

    const error = await runTool(
      createSocialPostTool,
      { socialAccountId: "sacct_x", content: "hi", draft: true },
      { session: session("owner", "ws_1") },
    ).catch((e) => e);

    expect(error.code).toBe("forbidden");
    expect(mockCreateSocialPost).not.toHaveBeenCalled();
  });

  it("refuses to publish to a disabled account", async () => {
    mockGetSocialAccount.mockResolvedValue(account({ disabled: true }));

    const error = await runTool(
      createSocialPostTool,
      { socialAccountId: "sacct_x", content: "hi", publishingApproval: approvalEvidence() },
      { session: session("owner", "ws_1") },
    ).catch((e) => e);

    expect(error.code).toBe("forbidden");
    expect(mockCreateSocialPost).not.toHaveBeenCalled();
  });

  it("rejects specifying both draft and scheduledAt", async () => {
    const error = await runTool(
      createSocialPostTool,
      {
        socialAccountId: "sacct_x",
        content: "hi",
        draft: true,
        scheduledAt: "2026-07-10T15:00:00.000Z",
      },
      { session: session("owner", "ws_1") },
    ).catch((e) => e);

    expect(error.code).toBe("invalid_input");
  });

  it("fails closed before creating a post when exact publishing Approval evidence is omitted", async () => {
    const error = await runTool(
      createSocialPostTool,
      { socialAccountId: "sacct_x", content: "publish me" },
      { session: session("owner", "ws_1") },
    ).catch((e) => e);

    expect(error.code).toBe("forbidden");
    expect(mockCreateSocialPost).not.toHaveBeenCalled();
    expect(mockInspectPublishingApproval).not.toHaveBeenCalled();
  });

  it("leaves only a draft and never queues when exact Approval consumption loses authority", async () => {
    mockConsumePublishingApproval.mockResolvedValue("authorization_stale");
    const error = await runTool(
      createSocialPostTool,
      { socialAccountId: "sacct_x", content: "Scheduled hello", publishingApproval: approvalEvidence() },
      { session: session("owner", "ws_1") },
    ).catch((e) => e);

    expect(error.code).toBe("forbidden");
    expect(mockCreateSocialPost).toHaveBeenCalledTimes(1);
    expect(mockUpdatePostStatus).not.toHaveBeenCalled();
  });

  it("denies callers whose role lacks social:publish", async () => {
    const memberSession = session("member");
    memberSession.permissions = memberSession.permissions.filter(
      (p) => p !== "social:publish",
    );

    const error = await runTool(
      createSocialPostTool,
      { socialAccountId: "sacct_x", content: "hi", draft: true },
      { session: memberSession },
    ).catch((e) => e);

    expect(error.code).toBe("forbidden");
    expect(mockGetSocialAccount).not.toHaveBeenCalled();
  });
});
