import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const mockWithApiPermission = vi.fn();
const mockCreateSocialPost = vi.fn();
const mockListSocialPosts = vi.fn();
const mockGetSocialPost = vi.fn();
const mockGetSocialAccountById = vi.fn();
const mockUpdateSocialPost = vi.fn();
const mockDeleteSocialPost = vi.fn();
const mockUpdatePostStatus = vi.fn();
const mockClaimSocialDispatchRun = vi.fn();
const mockFinalizeSocialDispatchRun = vi.fn();
const mockHasChainChildren = vi.fn();
const mockCountSocialPostsCreatedInRange = vi.fn();
const mockWorkflowStart = vi.fn();
const mockEmitSocialEvent = vi.fn();
const mockRequiresGovernedPublishingPlan = vi.fn();
const mockInspectPublishingApproval = vi.fn();
const mockConsumePublishingApproval = vi.fn();

vi.mock("@/lib/db", () => ({
  isDatabaseConfigured: vi.fn(() => true),
}));

vi.mock("@/lib/studio/authz", () => ({
  withApiPermission: mockWithApiPermission,
  authzErrorResponse: (result: { status: number; error: string }) =>
    NextResponse.json({ success: false, error: result.error }, { status: result.status }),
}));

vi.mock("@/lib/social/repository", () => ({
  createSocialPost: mockCreateSocialPost,
  listSocialPosts: mockListSocialPosts,
  getSocialPost: mockGetSocialPost,
  getSocialAccountById: mockGetSocialAccountById,
  updateSocialPost: mockUpdateSocialPost,
  deleteSocialPost: mockDeleteSocialPost,
  updatePostStatus: mockUpdatePostStatus,
  claimSocialDispatchRun: mockClaimSocialDispatchRun,
  finalizeSocialDispatchRun: mockFinalizeSocialDispatchRun,
  hasChainChildren: mockHasChainChildren,
  countSocialPostsCreatedInRange: mockCountSocialPostsCreatedInRange,
  SocialPostNotFoundError: class extends Error {
    constructor(id?: string) { super(`Post "${id}" not found.`); this.name = "SocialPostNotFoundError"; }
  },
  SocialPostStateTransitionError: class extends Error {
    constructor(from: string, to: string) {
      super(`Cannot transition from "${from}" to "${to}".`);
      this.name = "SocialPostStateTransitionError";
    }
  },
}));

vi.mock("workflow/api", () => ({
  start: mockWorkflowStart,
}));

vi.mock("@/lib/social/events", () => ({
  emitSocialEvent: mockEmitSocialEvent,
}));

vi.mock("@/utils/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("@/lib/governance/publishing-route-guard", () => ({
  requiresGovernedPublishingPlan: mockRequiresGovernedPublishingPlan,
}));
vi.mock("@/lib/agent-tools/social-publishing-approval", () => ({
  governedPublishingMarker: (input: unknown) => `approved:${JSON.stringify(input)}`,
  socialPublishingApprovalEvidenceSchema: { safeParse: (value: unknown) => value ? { success: true, data: value } : { success: false } },
  PRODUCTION_SOCIAL_PUBLISHING_APPROVAL_ADMISSION: { inspect: mockInspectPublishingApproval, consume: mockConsumePublishingApproval },
}));

const mockSession = {
  user: { id: "user_1", name: "Test", email: "test@example.com" },
  workspace: { id: "ws_1", organizationId: "org_1" },
  role: "owner" as const,
  planTier: "free" as const,
  permissions: ["social:view", "social:publish"],
};

function authorized() {
  mockWithApiPermission.mockResolvedValue({ authorized: true, session: mockSession });
}

function unauthorized(status: 401 | 403) {
  mockWithApiPermission.mockResolvedValue({
    authorized: false,
    response: NextResponse.json(
      { success: false, error: status === 401 ? "Unauthenticated" : "Forbidden" },
      { status },
    ),
  });
}

function createRequest(
  url = "http://localhost:3000/api/social/posts",
  init?: ConstructorParameters<typeof NextRequest>[1],
): NextRequest {
  return new NextRequest(url, init);
}

describe("/api/social/posts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCountSocialPostsCreatedInRange.mockResolvedValue(0);
  });

  describe("GET /api/social/posts", () => {
    it("returns 401 for unauthenticated requests", async () => {
      unauthorized(401);
      const { GET } = await import("../../posts/route");
      const response = await GET(createRequest());
      expect(response.status).toBe(401);
    });

    it("returns 403 for unauthorized requests", async () => {
      unauthorized(403);
      const { GET } = await import("../../posts/route");
      const response = await GET(createRequest());
      expect(response.status).toBe(403);
    });

    it("lists posts for workspace", async () => {
      authorized();
      mockListSocialPosts.mockResolvedValue([
        { id: "spost_1", status: "draft", content: "Hello" },
      ]);
      const { GET } = await import("../../posts/route");
      const response = await GET(createRequest());
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.posts).toHaveLength(1);
      expect(mockListSocialPosts).toHaveBeenCalledWith("ws_1", {
        status: undefined,
        socialAccountId: undefined,
        limit: undefined,
        offset: undefined,
      });
    });

    it("passes filter params to repository", async () => {
      authorized();
      mockListSocialPosts.mockResolvedValue([]);
      const { GET } = await import("../../posts/route");
      const response = await GET(
        createRequest("http://localhost:3000/api/social/posts?status=draft&socialAccountId=sacct_1&limit=10&offset=5"),
      );
      const data = await response.json();

      expect(data.success).toBe(true);
      expect(mockListSocialPosts).toHaveBeenCalledWith("ws_1", {
        status: "draft",
        socialAccountId: "sacct_1",
        limit: 10,
        offset: 5,
      });
    });
  });

  describe("POST /api/social/posts", () => {
    it("creates a draft post", async () => {
      authorized();
      mockCountSocialPostsCreatedInRange.mockResolvedValue(1);
      mockCreateSocialPost.mockResolvedValue({
        id: "spost_1",
        status: "draft",
        content: "Hello world",
      });
      const { POST } = await import("../../posts/route");
      const response = await POST(
        createRequest("http://localhost:3000/api/social/posts", {
          method: "POST",
          body: JSON.stringify({
            socialAccountId: "sacct_1",
            content: "Hello world",
          }),
        }),
      );
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.post.status).toBe("draft");
    });

    it("creates a chain child post with chain metadata", async () => {
      authorized();
      mockCountSocialPostsCreatedInRange.mockResolvedValue(1);
      mockCreateSocialPost.mockResolvedValue({
        id: "spost_child_1",
        status: "draft",
        rootPostId: "spost_root_1",
        kind: "chain_child",
        delaySeconds: 120,
        position: 2,
      });

      const { POST } = await import("../../posts/route");
      const response = await POST(
        createRequest("http://localhost:3000/api/social/posts", {
          method: "POST",
          body: JSON.stringify({
            socialAccountId: "sacct_1",
            content: "child",
            rootPostId: "spost_root_1",
            kind: "chain_child",
            delaySeconds: 120,
            position: 2,
            triggerSource: "chain",
            parentPostId: "spost_root_1",
          }),
        }),
      );

      expect(response.status).toBe(200);
      expect(mockCreateSocialPost).toHaveBeenCalledWith(
        expect.objectContaining({
          rootPostId: "spost_root_1",
          kind: "chain_child",
          delaySeconds: 120,
          position: 2,
          triggerSource: "chain",
          parentPostId: "spost_root_1",
        }),
      );
    });

    it("returns 400 when socialAccountId is missing", async () => {
      authorized();
      const { POST } = await import("../../posts/route");
      const response = await POST(
        createRequest("http://localhost:3000/api/social/posts", {
          method: "POST",
          body: JSON.stringify({ content: "Hello" }),
        }),
      );
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error).toContain("socialAccountId");
    });

    it("returns 400 when both content and media are empty", async () => {
      authorized();
      const { POST } = await import("../../posts/route");
      const response = await POST(
        createRequest("http://localhost:3000/api/social/posts", {
          method: "POST",
          body: JSON.stringify({ socialAccountId: "sacct_1" }),
        }),
      );
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toContain("Content or media");
    });

    it("returns 402 when monthly post quota is exceeded", async () => {
      authorized();
      mockCountSocialPostsCreatedInRange.mockResolvedValue(50);

      const { POST } = await import("../../posts/route");
      const response = await POST(
        createRequest("http://localhost:3000/api/social/posts", {
          method: "POST",
          body: JSON.stringify({
            socialAccountId: "sacct_1",
            content: "hello",
          }),
        }),
      );
      const data = await response.json();

      expect(response.status).toBe(402);
      expect(data.success).toBe(false);
      expect(data.code).toBe("quota_exceeded");
      expect(data.section).toBe("posts_per_month");
      expect(mockCreateSocialPost).not.toHaveBeenCalled();
    });
  });
});

describe("/api/social/posts/[postId]/publish", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHasChainChildren.mockResolvedValue(false);
    mockGetSocialAccountById.mockResolvedValue({
      id: "sacct_1",
      platform: "x",
      displayName: "X Channel",
    });
    mockClaimSocialDispatchRun.mockImplementation(
      (input: { claimToken?: string; dispatchKey: string }) => ({
        id: "sdrun_1",
        dispatchKey: input.dispatchKey,
        claimToken: input.claimToken,
        state: "claimed",
      }),
    );
    mockFinalizeSocialDispatchRun.mockResolvedValue({});
    mockRequiresGovernedPublishingPlan.mockResolvedValue(false);
    mockConsumePublishingApproval.mockResolvedValue("consumed");
  });

  it("refuses legacy direct dispatch when the Workspace requires governed Publishing Approval", async () => {
    authorized();
    mockRequiresGovernedPublishingPlan.mockResolvedValue(true);
    mockGetSocialPost.mockResolvedValue({ id: "spost_1", workspaceId: "ws_1", socialAccountId: "sacct_1", status: "draft" });
    const { POST } = await import("../../posts/[postId]/publish/route");
    const response = await POST(
      createRequest("http://localhost:3000/api/social/posts/spost_1/publish", { method: "POST" }),
      { params: Promise.resolve({ postId: "spost_1" }) },
    );
    expect(response.status).toBe(409);
    expect(mockGetSocialPost).toHaveBeenCalledWith("ws_1", "spost_1");
    expect(mockWorkflowStart).not.toHaveBeenCalled();
  });

  it("returns 401 for unauthenticated requests", async () => {
    unauthorized(401);
    const { POST } = await import("../../posts/[postId]/publish/route");
    const response = await POST(
      createRequest("http://localhost:3000/api/social/posts/spost_1/publish", { method: "POST" }),
      { params: Promise.resolve({ postId: "spost_1" }) },
    );
    expect(response.status).toBe(401);
  });

  it("transitions draft → queued", async () => {
    authorized();
    mockGetSocialPost.mockResolvedValue({
      id: "spost_1",
      status: "draft",
      dispatchAttempts: 0,
    });
    mockUpdatePostStatus
      .mockResolvedValueOnce({ id: "spost_1", status: "queued" })
      .mockResolvedValueOnce({
        id: "spost_1",
        status: "queued",
        dispatchStatus: "dispatched",
        workflowRunRef: "workflow-run-1",
      });
    mockWorkflowStart.mockResolvedValue({ runId: "workflow-run-1" });

    const { POST } = await import("../../posts/[postId]/publish/route");
    const response = await POST(
      createRequest("http://localhost:3000/api/social/posts/spost_1/publish", { method: "POST" }),
      { params: Promise.resolve({ postId: "spost_1" }) },
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.post.status).toBe("queued");
    expect(mockUpdatePostStatus).toHaveBeenNthCalledWith(1, "spost_1", "queued", {
      errorMessage: null,
      retryCount: undefined,
      dispatchStatus: "pending",
      dispatchAttempts: 1,
      workflowRunRef: null,
      nextDispatchAt: null,
      lastDispatchError: null,
      lockedAt: expect.any(Date),
    });
    expect(mockUpdatePostStatus).toHaveBeenNthCalledWith(2, "spost_1", "queued", {
      dispatchStatus: "dispatched",
      workflowRunRef: "workflow-run-1",
      lockedAt: null,
    });
  });

  it("returns 400 when Publishing Settings are invalid for the post Channel", async () => {
    authorized();
    mockGetSocialPost.mockResolvedValue({
      id: "spost_1",
      status: "draft",
      dispatchAttempts: 0,
      content: "Video description",
      mediaUrls: [{ type: "video", url: "https://example.com/video.mp4" }],
      stableMediaRefs: [{ resourceKind: "studio_asset", assetId: "asset-1", assetDigest: `sha256:${"a".repeat(64)}`, order: 0 }],
      platformSettings: { privacyStatus: "private" },
      socialAccountId: "sacct_youtube",
    });
    mockGetSocialAccountById.mockResolvedValue({
      id: "sacct_youtube",
      platform: "youtube",
      displayName: "Studio YouTube",
    });

    const { POST } = await import("../../posts/[postId]/publish/route");
    const response = await POST(
      createRequest("http://localhost:3000/api/social/posts/spost_1/publish", {
        method: "POST",
      }),
      { params: Promise.resolve({ postId: "spost_1" }) },
    );
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toContain("Studio YouTube: YouTube title is required.");
    expect(mockUpdatePostStatus).not.toHaveBeenCalled();
    expect(mockWorkflowStart).not.toHaveBeenCalled();
  });

  it("fails closed before dispatch when caller media lacks an ordered digest-bound Workspace reference", async () => {
    authorized();
    mockGetSocialPost.mockResolvedValue({
      id: "spost_1",
      status: "draft",
      dispatchAttempts: 0,
      content: "Unbound media",
      mediaUrls: [{ type: "image", url: "https://attacker.invalid/same-name.png" }],
      stableMediaRefs: [],
      socialAccountId: "sacct_1",
    });

    const { POST } = await import("../../posts/[postId]/publish/route");
    const response = await POST(
      createRequest("http://localhost:3000/api/social/posts/spost_1/publish", { method: "POST" }),
      { params: Promise.resolve({ postId: "spost_1" }) },
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ success: false, error: expect.stringContaining("SHA-256 reference") });
    expect(mockWorkflowStart).not.toHaveBeenCalled();
  });

  it("rejects a governed post when its stable bytes differ from the approved artifact", async () => {
    authorized();
    mockRequiresGovernedPublishingPlan.mockResolvedValue(true);
    mockGetSocialPost.mockResolvedValue({
      id: "spost_1",
      status: "draft",
      dispatchAttempts: 0,
      content: "Approved text",
      mediaUrls: [{ type: "image", url: "/approved-preview/artifact-1" }],
      stableMediaRefs: [{ resourceKind: "artifact", assetId: "artifact-other", assetDigest: `sha256:${"a".repeat(64)}`, order: 0 }],
      platformSettings: { type: "person" },
      socialAccountId: "sacct_1",
    });
    mockInspectPublishingApproval.mockResolvedValue({
      requestId: "approval-1",
      target: {
        targetId: "target-1",
        content: { text: "Approved text" },
        media: [{ artifactId: "artifact-1", digest: `sha256:${"b".repeat(64)}`, previewUrl: "/approved-preview/artifact-1" }],
        settings: { type: "person" },
        timing: { kind: "now", publishAt: new Date().toISOString() },
      },
    });

    const { POST } = await import("../../posts/[postId]/publish/route");
    const response = await POST(
      createRequest("http://localhost:3000/api/social/posts/spost_1/publish", {
        method: "POST",
        body: JSON.stringify({ publishingApproval: { consumingPrincipalId: "user_1" }, idempotencyKey: "publish-once" }),
      }),
      { params: Promise.resolve({ postId: "spost_1" }) },
    );

    expect(response.status).toBe(409);
    expect(mockConsumePublishingApproval).not.toHaveBeenCalled();
    expect(mockWorkflowStart).not.toHaveBeenCalled();
  });

  it("resets retryCount when retrying a failed post", async () => {
    authorized();
    mockGetSocialPost.mockResolvedValue({
      id: "spost_1",
      status: "failed",
      retryCount: 3,
      dispatchAttempts: 2,
    });
    mockUpdatePostStatus
      .mockResolvedValueOnce({ id: "spost_1", status: "queued", retryCount: 0 })
      .mockResolvedValueOnce({
        id: "spost_1",
        status: "queued",
        retryCount: 0,
        dispatchStatus: "dispatched",
      });
    mockWorkflowStart.mockResolvedValue({ runId: "workflow-run-2" });

    const { POST } = await import("../../posts/[postId]/publish/route");
    const response = await POST(
      createRequest("http://localhost:3000/api/social/posts/spost_1/publish", { method: "POST" }),
      { params: Promise.resolve({ postId: "spost_1" }) },
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(mockUpdatePostStatus).toHaveBeenNthCalledWith(1, "spost_1", "queued", {
      errorMessage: null,
      retryCount: 0,
      dispatchStatus: "pending",
      dispatchAttempts: 3,
      workflowRunRef: null,
      nextDispatchAt: null,
      lastDispatchError: null,
      lockedAt: expect.any(Date),
    });
  });

  it("persists retry schedule when workflow start fails", async () => {
    authorized();
    mockGetSocialPost.mockResolvedValue({
      id: "spost_1",
      status: "draft",
      retryCount: 0,
      dispatchAttempts: 0,
    });
    mockUpdatePostStatus
      .mockResolvedValueOnce({ id: "spost_1", status: "queued" })
      .mockResolvedValueOnce({
        id: "spost_1",
        status: "queued",
        dispatchStatus: "retry_scheduled",
      });
    mockWorkflowStart.mockRejectedValue(new Error("WDK start failed"));

    const { POST } = await import("../../posts/[postId]/publish/route");
    const response = await POST(
      createRequest("http://localhost:3000/api/social/posts/spost_1/publish", { method: "POST" }),
      { params: Promise.resolve({ postId: "spost_1" }) },
    );
    const data = await response.json();

    expect(response.status).toBe(503);
    expect(data.success).toBe(false);
    expect(mockUpdatePostStatus).toHaveBeenNthCalledWith(2, "spost_1", "queued", {
      errorMessage: "Dispatch failed. Automatic retry has been scheduled.",
      dispatchStatus: "retry_scheduled",
      nextDispatchAt: expect.any(Date),
      lastDispatchError: "WDK start failed",
      workflowRunRef: null,
      lockedAt: null,
    });
  });

  it("selects chain workflow when post has chain children", async () => {
    authorized();
    mockGetSocialPost.mockResolvedValue({
      id: "spost_root",
      status: "draft",
      dispatchAttempts: 0,
      rootPostId: null,
      kind: "post",
    });
    mockHasChainChildren.mockResolvedValue(true);
    mockUpdatePostStatus
      .mockResolvedValueOnce({ id: "spost_root", status: "queued" })
      .mockResolvedValueOnce({
        id: "spost_root",
        status: "queued",
        dispatchStatus: "dispatched",
      });
    mockWorkflowStart.mockResolvedValue({ runId: "workflow-run-chain" });

    const { POST } = await import("../../posts/[postId]/publish/route");
    const response = await POST(
      createRequest("http://localhost:3000/api/social/posts/spost_root/publish", {
        method: "POST",
      }),
      { params: Promise.resolve({ postId: "spost_root" }) },
    );

    expect(response.status).toBe(200);
    const [workflowFn] = mockWorkflowStart.mock.calls[0] ?? [];
    expect(typeof workflowFn).toBe("function");
    expect((workflowFn as { name?: string }).name).toBe(
      "publishPostChainWorkflow",
    );
  });

  it("returns 400 for published post", async () => {
    authorized();
    mockGetSocialPost.mockResolvedValue({ id: "spost_1", status: "published" });

    const { POST } = await import("../../posts/[postId]/publish/route");
    const response = await POST(
      createRequest("http://localhost:3000/api/social/posts/spost_1/publish", { method: "POST" }),
      { params: Promise.resolve({ postId: "spost_1" }) },
    );
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toContain("published");
  });

  it("returns 400 for queued post", async () => {
    authorized();
    mockGetSocialPost.mockResolvedValue({ id: "spost_1", status: "queued" });

    const { POST } = await import("../../posts/[postId]/publish/route");
    const response = await POST(
      createRequest("http://localhost:3000/api/social/posts/spost_1/publish", { method: "POST" }),
      { params: Promise.resolve({ postId: "spost_1" }) },
    );
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toContain("queued");
  });

  it("force-publishes queued post immediately", async () => {
    authorized();
    mockGetSocialPost.mockResolvedValue({
      id: "spost_1",
      status: "queued",
      dispatchAttempts: 1,
      socialAccountId: "sacct_1",
      scheduledAt: new Date(Date.now() + 60 * 60 * 1000),
      rootPostId: null,
      kind: "post",
    });
    mockUpdatePostStatus
      .mockResolvedValueOnce({ id: "spost_1", status: "queued" })
      .mockResolvedValueOnce({
        id: "spost_1",
        status: "queued",
        dispatchStatus: "dispatched",
      });
    mockWorkflowStart.mockResolvedValue({ runId: "workflow-run-now" });

    const { POST } = await import("../../posts/[postId]/publish/route");
    const response = await POST(
      createRequest("http://localhost:3000/api/social/posts/spost_1/publish", {
        method: "POST",
        body: JSON.stringify({ forceNow: true }),
      }),
      { params: Promise.resolve({ postId: "spost_1" }) },
    );

    expect(response.status).toBe(200);
    expect(mockUpdatePostStatus).toHaveBeenNthCalledWith(1, "spost_1", "queued", {
      scheduledAt: expect.any(Date),
      errorMessage: null,
      retryCount: undefined,
      dispatchStatus: "pending",
      dispatchAttempts: 2,
      workflowRunRef: null,
      nextDispatchAt: expect.any(Date),
      lastDispatchError: null,
      lockedAt: expect.any(Date),
    });
  });

  it("force-publishes future publishing post immediately", async () => {
    authorized();
    mockGetSocialPost.mockResolvedValue({
      id: "spost_1",
      status: "publishing",
      dispatchAttempts: 1,
      socialAccountId: "sacct_1",
      scheduledAt: new Date(Date.now() + 60 * 60 * 1000),
      rootPostId: null,
      kind: "post",
    });
    mockUpdatePostStatus
      .mockResolvedValueOnce({ id: "spost_1", status: "queued" })
      .mockResolvedValueOnce({
        id: "spost_1",
        status: "queued",
        dispatchStatus: "dispatched",
      });
    mockWorkflowStart.mockResolvedValue({ runId: "workflow-run-now" });

    const { POST } = await import("../../posts/[postId]/publish/route");
    const response = await POST(
      createRequest("http://localhost:3000/api/social/posts/spost_1/publish", {
        method: "POST",
        body: JSON.stringify({ forceNow: true }),
      }),
      { params: Promise.resolve({ postId: "spost_1" }) },
    );

    expect(response.status).toBe(200);
  });

  it("returns 400 for publishing post", async () => {
    authorized();
    mockGetSocialPost.mockResolvedValue({ id: "spost_1", status: "publishing" });

    const { POST } = await import("../../posts/[postId]/publish/route");
    const response = await POST(
      createRequest("http://localhost:3000/api/social/posts/spost_1/publish", { method: "POST" }),
      { params: Promise.resolve({ postId: "spost_1" }) },
    );

    expect(response.status).toBe(400);
  });
});
