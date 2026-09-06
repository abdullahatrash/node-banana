import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mockIsDatabaseConfigured = vi.fn(() => true);
const mockListDueQueuedPosts = vi.fn();
const mockClaimPostForDispatch = vi.fn();
const mockClaimSocialDispatchRun = vi.fn();
const mockFinalizeSocialDispatchRun = vi.fn();
const mockGetSocialAccount = vi.fn();
const mockHasChainChildren = vi.fn();
const mockUpdatePostStatus = vi.fn();
const mockWorkflowStart = vi.fn();
const mockEmitSocialEvent = vi.fn();
const mockGetProvider = vi.fn();
const mockRegisterProvider = vi.fn();
const mockRequiresGovernedPublishingPlan = vi.fn();
const mockVerifyConsumed = vi.fn();

vi.mock("@/lib/db", () => ({
  isDatabaseConfigured: mockIsDatabaseConfigured,
}));

vi.mock("@/lib/social/repository", () => ({
  listDueQueuedPosts: mockListDueQueuedPosts,
  listQueuedDispatchedPostsMissingWorkflow: mockListDueQueuedPosts,
  claimPostForDispatch: mockClaimPostForDispatch,
  claimQueuedDispatchedPostForRecovery: mockClaimPostForDispatch,
  claimSocialDispatchRun: mockClaimSocialDispatchRun,
  finalizeSocialDispatchRun: mockFinalizeSocialDispatchRun,
  getSocialAccount: mockGetSocialAccount,
  SocialAccountNotFoundError: class extends Error {},
  hasChainChildren: mockHasChainChildren,
  updatePostStatus: mockUpdatePostStatus,
}));

vi.mock("@/lib/social/provider-registry", () => ({
  getProvider: mockGetProvider,
  registerProvider: mockRegisterProvider,
}));

vi.mock("workflow/api", () => ({
  start: mockWorkflowStart,
}));

vi.mock("@/lib/social/events", () => ({
  emitSocialEvent: mockEmitSocialEvent,
}));
vi.mock("@/lib/governance/publishing-route-guard", () => ({ requiresGovernedPublishingPlan: mockRequiresGovernedPublishingPlan }));
vi.mock("@/lib/agent-tools/social-publishing-approval", () => ({ parseGovernedPublishingMarker: () => null, PRODUCTION_SOCIAL_PUBLISHING_APPROVAL_ADMISSION: { verifyConsumed: mockVerifyConsumed } }));

vi.mock("@/utils/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

function createRequest(url = "http://localhost:3000/api/social/internal/dispatch"): NextRequest {
  return new NextRequest(url, {
    method: "POST",
    headers: {
      "x-social-internal-secret": "secret_123",
    },
  });
}

describe("/api/social/internal/dispatch POST", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SOCIAL_INTERNAL_API_SECRET = "secret_123";
    delete process.env.SOCIAL_DISPATCH_MAX_ATTEMPTS;
    mockClaimSocialDispatchRun.mockImplementation(
      (input: { claimToken?: string; dispatchKey: string }) => ({
        id: "sdrun_1",
        dispatchKey: input.dispatchKey,
        claimToken: input.claimToken,
        state: "claimed",
      }),
    );
    mockFinalizeSocialDispatchRun.mockResolvedValue({});
    mockGetProvider.mockReturnValue({
      identifier: "linkedin",
      maxConcurrentJobs: 5,
    });
    mockHasChainChildren.mockResolvedValue(false);
    mockRequiresGovernedPublishingPlan.mockResolvedValue(false);
    mockVerifyConsumed.mockResolvedValue(true);
  });

  it("returns 401 for unauthorized request", async () => {
    const { POST } = await import("../route");
    const request = new NextRequest("http://localhost:3000/api/social/internal/dispatch", {
      method: "POST",
    });

    const response = await POST(request);
    expect(response.status).toBe(401);
  });

  it.each(["dispatch", "recover-missing-dispatch"])("%s fails an invalid channel association without starting a workflow", async (endpoint) => {
    const { SocialAccountNotFoundError } = await import("@/lib/social/repository");
    mockListDueQueuedPosts.mockResolvedValue([{ id: "bad", workspaceId: "ws_1" }]);
    mockClaimPostForDispatch.mockResolvedValue({ id: "bad", workspaceId: "ws_1", socialAccountId: "foreign", dispatchAttempts: 1 });
    mockGetSocialAccount.mockRejectedValueOnce(new SocialAccountNotFoundError("foreign"));
    const { POST } = endpoint === "dispatch"
      ? await import("../route")
      : await import("../../recover-missing-dispatch/route");
    const response = await POST(createRequest(`http://localhost:3000/api/social/internal/${endpoint}`));
    expect(response.status).toBe(200);
    expect(mockGetSocialAccount).toHaveBeenCalledWith("ws_1", "foreign");
    expect(mockWorkflowStart).not.toHaveBeenCalled();
    expect(mockUpdatePostStatus).toHaveBeenCalledWith("bad", "failed", expect.objectContaining({ lastDispatchError: "channel_not_found" }));
  });

  it("dispatches claimed queued posts", async () => {
    mockListDueQueuedPosts.mockResolvedValue([
      { id: "spost_1", workspaceId: "ws_1" },
      { id: "spost_2", workspaceId: "ws_1" },
    ]);
    mockClaimPostForDispatch
      .mockResolvedValueOnce({
        id: "spost_1",
        workspaceId: "ws_1",
        dispatchAttempts: 1,
      })
      .mockResolvedValueOnce(null);
    mockWorkflowStart.mockResolvedValue({ runId: "run_123" });
    mockUpdatePostStatus.mockResolvedValue({});

    const { POST } = await import("../route");
    const response = await POST(createRequest());
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.summary).toEqual({
      scanned: 2,
      dispatched: 1,
      retryScheduled: 0,
      failed: 0,
      skipped: 1,
    });
    expect(mockUpdatePostStatus).toHaveBeenCalledWith("spost_1", "queued", {
      dispatchStatus: "dispatched",
      workflowRunRef: "run_123",
      nextDispatchAt: null,
      lastDispatchError: null,
      lockedAt: null,
    });
  });

  it("never claims a queued post without exact governed evidence when policy is active", async () => {
    mockRequiresGovernedPublishingPlan.mockResolvedValue(true);
    mockVerifyConsumed.mockResolvedValue(false);
    mockListDueQueuedPosts.mockResolvedValue([{ id: "spost_1", workspaceId: "ws_1", socialAccountId: "ch_1", createdByUserId: "u_1" }]);
    mockUpdatePostStatus.mockResolvedValue({});
    const { POST } = await import("../route");
    const response = await POST(createRequest());
    expect(response.status).toBe(200);
    expect(mockClaimPostForDispatch).not.toHaveBeenCalled();
    expect(mockUpdatePostStatus).toHaveBeenCalledWith("spost_1", "failed", expect.objectContaining({ lastDispatchError: "governed_publishing_evidence_invalid" }));
  });

  it("schedules retry when workflow dispatch fails", async () => {
    mockListDueQueuedPosts.mockResolvedValue([{ id: "spost_1", workspaceId: "ws_1" }]);
    mockClaimPostForDispatch.mockResolvedValue({
      id: "spost_1",
      workspaceId: "ws_1",
      dispatchAttempts: 1,
    });
    mockWorkflowStart.mockRejectedValue(new Error("workflow start failed"));
    mockUpdatePostStatus.mockResolvedValue({});

    const { POST } = await import("../route");
    const response = await POST(createRequest());
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.summary.retryScheduled).toBe(1);
    expect(mockUpdatePostStatus).toHaveBeenCalledWith("spost_1", "queued", {
      dispatchStatus: "retry_scheduled",
      errorMessage: "Dispatch failed. Retry has been scheduled.",
      workflowRunRef: null,
      nextDispatchAt: expect.any(Date),
      lastDispatchError: "workflow start failed",
      lockedAt: null,
    });
    expect(mockEmitSocialEvent).toHaveBeenCalledWith({
      workspaceId: "ws_1",
      eventType: "dispatch.failed",
      severity: "warn",
      message: "Dispatch failed and was scheduled for retry.",
      postId: "spost_1",
      dispatchKey: "publish:system:spost_1:1",
      metadata: expect.objectContaining({
        attempts: 1,
        error: "workflow start failed",
        retryAt: expect.any(String),
      }),
    });
  });

  it("marks post failed when max dispatch attempts reached", async () => {
    process.env.SOCIAL_DISPATCH_MAX_ATTEMPTS = "2";
    mockListDueQueuedPosts.mockResolvedValue([{ id: "spost_1", workspaceId: "ws_1" }]);
    mockClaimPostForDispatch.mockResolvedValue({
      id: "spost_1",
      workspaceId: "ws_1",
      dispatchAttempts: 2,
    });
    mockWorkflowStart.mockRejectedValue(new Error("workflow start failed"));
    mockUpdatePostStatus.mockResolvedValue({});

    const { POST } = await import("../route");
    const response = await POST(createRequest());
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.summary.failed).toBe(1);
    expect(mockUpdatePostStatus).toHaveBeenCalledWith("spost_1", "failed", {
      dispatchStatus: "failed",
      errorMessage: "Dispatch failed after maximum retry attempts.",
      nextDispatchAt: null,
      workflowRunRef: null,
      lastDispatchError: "workflow start failed",
      lockedAt: null,
    });
    expect(mockEmitSocialEvent).toHaveBeenCalledWith({
      workspaceId: "ws_1",
      eventType: "post.failed",
      severity: "error",
      message: "Post failed after repeated dispatch failures.",
      userFacing: true,
      postId: "spost_1",
      dispatchKey: "publish:system:spost_1:2",
      metadata: {
        attempts: 2,
        error: "workflow start failed",
      },
    });
  });

  it("falls back to a dispatch-key-based workflow ref when the workflow run lacks ids", async () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    mockListDueQueuedPosts.mockResolvedValue([{ id: "spost_1", workspaceId: "ws_1" }]);
    mockClaimPostForDispatch.mockResolvedValue({
      id: "spost_1",
      workspaceId: "ws_1",
      dispatchAttempts: 1,
    });
    mockWorkflowStart.mockResolvedValue({});
    mockUpdatePostStatus.mockResolvedValue({});

    const { POST } = await import("../route");
    const response = await POST(createRequest());

    expect(response.status).toBe(200);
    expect(mockUpdatePostStatus).toHaveBeenCalledWith("spost_1", "queued", {
      dispatchStatus: "dispatched",
      workflowRunRef: "publish:system:spost_1:1:1700000000000",
      nextDispatchAt: null,
      lastDispatchError: null,
      lockedAt: null,
    });

    nowSpy.mockRestore();
  });

  it("uses chain workflow for root posts with children", async () => {
    mockListDueQueuedPosts.mockResolvedValue([{ id: "spost_root", workspaceId: "ws_1" }]);
    mockClaimPostForDispatch.mockResolvedValue({
      id: "spost_root",
      workspaceId: "ws_1",
      rootPostId: null,
      kind: "post",
      dispatchAttempts: 1,
    });
    mockHasChainChildren.mockResolvedValue(true);
    mockWorkflowStart.mockResolvedValue({ runId: "run_chain_1" });
    mockUpdatePostStatus.mockResolvedValue({});

    const { POST } = await import("../route");
    const response = await POST(createRequest());

    expect(response.status).toBe(200);
    expect(mockWorkflowStart).toHaveBeenCalledTimes(1);
    const [workflowFn] = mockWorkflowStart.mock.calls[0] ?? [];
    expect(typeof workflowFn).toBe("function");
    expect((workflowFn as { name?: string }).name).toBe(
      "publishPostChainWorkflow",
    );
  });

  it("supports GET as a cron-triggered dispatch", async () => {
    mockListDueQueuedPosts.mockResolvedValue([]);

    const { GET } = await import("../route");
    const response = await GET(createRequest());
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
  });
});
