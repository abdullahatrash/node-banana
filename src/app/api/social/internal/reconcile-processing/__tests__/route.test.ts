import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mockListPublishingPostsForReconciliation = vi.fn();
const mockUpdatePostStatus = vi.fn();
const mockMarkRequiresReauth = vi.fn();
const mockDecryptToken = vi.fn();
const mockEmitSocialEvent = vi.fn();
const mockGetProvider = vi.fn();

vi.mock("@/lib/db", () => ({
  isDatabaseConfigured: vi.fn(() => true),
}));

vi.mock("@/lib/social/repository", () => ({
  listPublishingPostsForReconciliation: (...args: unknown[]) =>
    mockListPublishingPostsForReconciliation(...args),
  updatePostStatus: (...args: unknown[]) => mockUpdatePostStatus(...args),
  markRequiresReauth: (...args: unknown[]) => mockMarkRequiresReauth(...args),
}));

vi.mock("@/lib/social/crypto", () => ({
  decryptToken: (...args: unknown[]) => mockDecryptToken(...args),
}));

vi.mock("@/lib/social/events", () => ({
  emitSocialEvent: (...args: unknown[]) => mockEmitSocialEvent(...args),
}));

vi.mock("@/lib/social/provider-registry", () => ({
  getProvider: (...args: unknown[]) => mockGetProvider(...args),
}));

vi.mock("@/utils/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

function createRequest(headers?: Record<string, string>): NextRequest {
  return new NextRequest(
    "http://localhost:3000/api/social/internal/reconcile-processing",
    {
      method: "POST",
      headers,
    },
  );
}

describe("/api/social/internal/reconcile-processing POST", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SOCIAL_INTERNAL_API_SECRET = "secret_123";
    mockDecryptToken.mockReturnValue("access-token");
  });

  it("returns 401 for unauthorized request", async () => {
    const { POST } = await import("../route");
    const response = await POST(createRequest());
    expect(response.status).toBe(401);
  });

  it("reconciles processing post to published", async () => {
    mockListPublishingPostsForReconciliation.mockResolvedValue([
      {
        postId: "spost_1",
        workspaceId: "ws_1",
        socialAccountId: "sacct_1",
        platformPostId: "publish-id-1",
        platformPostUrl: "https://tiktok.com/@u",
        updatedAt: new Date(Date.now() - 120_000),
        accountId: "sacct_1",
        platform: "tiktok",
        platformUserId: "u",
        accessTokenEncrypted: "enc_access",
        accessTokenSecret: null,
        disabled: false,
        requiresReauth: false,
      },
    ]);
    mockGetProvider.mockReturnValue({
      getPostStatus: vi.fn().mockResolvedValue({
        platformPostId: "vid123",
        platformPostUrl: "https://tiktok.com/@u/video/vid123",
        status: "published",
      }),
      classifyError: vi.fn(() => ({ type: "retry", message: "retry" })),
    });

    const { POST } = await import("../route");
    const response = await POST(
      createRequest({ "x-social-internal-secret": "secret_123" }),
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.summary).toEqual({
      scanned: 1,
      reconciled: 1,
      stillProcessing: 0,
      failed: 0,
      skipped: 0,
    });
    expect(mockUpdatePostStatus).toHaveBeenCalledWith("spost_1", "published", {
      platformPostId: "vid123",
      platformPostUrl: "https://tiktok.com/@u/video/vid123",
      publishedAt: expect.any(Date),
      errorMessage: null,
    });
  });

  it("keeps post in publishing when provider still processing", async () => {
    mockListPublishingPostsForReconciliation.mockResolvedValue([
      {
        postId: "spost_1",
        workspaceId: "ws_1",
        socialAccountId: "sacct_1",
        platformPostId: "publish-id-1",
        platformPostUrl: "https://tiktok.com/@u",
        updatedAt: new Date(Date.now() - 120_000),
        accountId: "sacct_1",
        platform: "tiktok",
        platformUserId: "u",
        accessTokenEncrypted: "enc_access",
        accessTokenSecret: null,
        disabled: false,
        requiresReauth: false,
      },
    ]);
    mockGetProvider.mockReturnValue({
      getPostStatus: vi.fn().mockResolvedValue({
        platformPostId: "publish-id-1",
        platformPostUrl: "https://tiktok.com/@u",
        status: "processing",
      }),
      classifyError: vi.fn(() => ({ type: "retry", message: "retry" })),
    });

    const { POST } = await import("../route");
    const response = await POST(
      createRequest({ "x-social-internal-secret": "secret_123" }),
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.summary.stillProcessing).toBe(1);
    expect(mockUpdatePostStatus).toHaveBeenCalledWith("spost_1", "publishing", {
      platformPostId: "publish-id-1",
      platformPostUrl: "https://tiktok.com/@u",
      errorMessage: null,
    });
  });

  it("marks post failed and account reauth required on refresh-token classification", async () => {
    mockListPublishingPostsForReconciliation.mockResolvedValue([
      {
        postId: "spost_1",
        workspaceId: "ws_1",
        socialAccountId: "sacct_1",
        platformPostId: "publish-id-1",
        platformPostUrl: "https://tiktok.com/@u",
        updatedAt: new Date(Date.now() - 120_000),
        accountId: "sacct_1",
        platform: "tiktok",
        platformUserId: "u",
        accessTokenEncrypted: "enc_access",
        accessTokenSecret: null,
        disabled: false,
        requiresReauth: false,
      },
    ]);
    mockGetProvider.mockReturnValue({
      getPostStatus: vi.fn().mockRejectedValue(new Error("invalid token")),
      classifyError: vi.fn(() => ({
        type: "refresh-token",
        message: "token invalid",
      })),
    });

    const { POST } = await import("../route");
    const response = await POST(
      createRequest({ "x-social-internal-secret": "secret_123" }),
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.summary.failed).toBe(1);
    expect(mockMarkRequiresReauth).toHaveBeenCalledWith("sacct_1");
    expect(mockUpdatePostStatus).toHaveBeenCalledWith("spost_1", "failed", {
      errorMessage: "Authentication expired. Please reconnect your account.",
    });
  });
});
