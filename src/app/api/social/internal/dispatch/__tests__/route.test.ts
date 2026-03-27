import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mockIsDatabaseConfigured = vi.fn(() => true);
const mockListDueQueuedPosts = vi.fn();
const mockClaimPostForDispatch = vi.fn();
const mockUpdatePostStatus = vi.fn();
const mockWorkflowStart = vi.fn();
const mockEmitSocialEvent = vi.fn();

vi.mock("@/lib/db", () => ({
  isDatabaseConfigured: (...args: unknown[]) => mockIsDatabaseConfigured(...args),
}));

vi.mock("@/lib/social/repository", () => ({
  listDueQueuedPosts: (...args: unknown[]) => mockListDueQueuedPosts(...args),
  claimPostForDispatch: (...args: unknown[]) => mockClaimPostForDispatch(...args),
  updatePostStatus: (...args: unknown[]) => mockUpdatePostStatus(...args),
}));

vi.mock("workflow/api", () => ({
  start: (...args: unknown[]) => mockWorkflowStart(...args),
}));

vi.mock("@/lib/social/events", () => ({
  emitSocialEvent: (...args: unknown[]) => mockEmitSocialEvent(...args),
}));

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
  });

  it("returns 401 for unauthorized request", async () => {
    const { POST } = await import("../route");
    const request = new NextRequest("http://localhost:3000/api/social/internal/dispatch", {
      method: "POST",
    });

    const response = await POST(request);
    expect(response.status).toBe(401);
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
  });
});
