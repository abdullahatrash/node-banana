import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mockIsDatabaseConfigured = vi.fn(() => true);
const mockListStalePublishingPosts = vi.fn();
const mockUpdatePostStatus = vi.fn();
const mockEmitSocialEvent = vi.fn();

vi.mock("@/lib/db", () => ({
  isDatabaseConfigured: (...args: unknown[]) => mockIsDatabaseConfigured(...args),
}));

vi.mock("@/lib/social/repository", () => ({
  listStalePublishingPosts: (...args: unknown[]) =>
    mockListStalePublishingPosts(...args),
  updatePostStatus: (...args: unknown[]) => mockUpdatePostStatus(...args),
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

function createRequest(
  url = "http://localhost:3000/api/social/internal/sweep-stuck",
): NextRequest {
  return new NextRequest(url, {
    method: "POST",
    headers: {
      "x-social-internal-secret": "secret_123",
    },
  });
}

describe("/api/social/internal/sweep-stuck POST", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SOCIAL_INTERNAL_API_SECRET = "secret_123";
    delete process.env.SOCIAL_STUCK_MAX_RECOVERY_ATTEMPTS;
  });

  it("returns 401 for unauthorized request", async () => {
    const { POST } = await import("../route");
    const request = new NextRequest("http://localhost:3000/api/social/internal/sweep-stuck", {
      method: "POST",
    });

    const response = await POST(request);
    expect(response.status).toBe(401);
  });

  it("requeues stale publishing posts", async () => {
    mockListStalePublishingPosts.mockResolvedValue([{ id: "spost_1", retryCount: 1 }]);
    mockUpdatePostStatus.mockResolvedValue({});

    const { POST } = await import("../route");
    const response = await POST(createRequest());
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.summary).toEqual({
      scanned: 1,
      requeued: 1,
      failed: 0,
    });
    expect(mockUpdatePostStatus).toHaveBeenCalledWith("spost_1", "queued", {
      retryCount: 2,
      errorMessage: "Publishing timed out. Post requeued for retry.",
      dispatchStatus: "retry_scheduled",
      nextDispatchAt: expect.any(Date),
      workflowRunRef: null,
      lastDispatchError: "stuck_publishing_timeout",
      lockedAt: null,
    });
  });

  it("marks stale publishing posts failed after max recovery attempts", async () => {
    process.env.SOCIAL_STUCK_MAX_RECOVERY_ATTEMPTS = "3";
    mockListStalePublishingPosts.mockResolvedValue([{ id: "spost_1", retryCount: 3 }]);
    mockUpdatePostStatus.mockResolvedValue({});

    const { POST } = await import("../route");
    const response = await POST(createRequest());
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.summary).toEqual({
      scanned: 1,
      requeued: 0,
      failed: 1,
    });
    expect(mockUpdatePostStatus).toHaveBeenCalledWith("spost_1", "failed", {
      retryCount: 4,
      errorMessage: "Publishing timed out repeatedly and was moved to failed state.",
      dispatchStatus: "failed",
      nextDispatchAt: null,
      workflowRunRef: null,
      lastDispatchError: "stuck_publishing_timeout",
      lockedAt: null,
    });
  });
});
