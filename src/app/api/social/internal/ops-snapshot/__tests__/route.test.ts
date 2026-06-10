import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const mockIsDatabaseConfigured = vi.fn(() => true);
const mockGetDb = vi.fn();
const mockEnsureInternalSocialAuth = vi.fn();

vi.mock("@/lib/db", () => ({
  isDatabaseConfigured: (...args: unknown[]) => mockIsDatabaseConfigured(...(args as [])),
  getDb: (...args: unknown[]) => mockGetDb(...(args as [])),
}));

vi.mock("@/lib/social/internal-auth", () => ({
  ensureInternalSocialAuth: (...args: unknown[]) =>
    mockEnsureInternalSocialAuth(...args),
}));

function createRequest(
  url = "http://localhost:3000/api/social/internal/ops-snapshot",
) {
  return new NextRequest(url, {
    method: "GET",
    headers: {
      "x-social-internal-secret": "secret_123",
    },
  });
}

function createDbMock(row: { count?: number; oldest?: Date | string | null }) {
  return {
    select: vi.fn(() => {
      const builder: any = {};
      builder.from = vi.fn(() => builder);
      builder.where = vi.fn(() => builder);
      builder.then = (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
        Promise.resolve([row]).then(resolve, reject);
      return builder;
    }),
  };
}

describe("/api/social/internal/ops-snapshot", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SOCIAL_INTERNAL_API_SECRET = "secret_123";
    mockIsDatabaseConfigured.mockReturnValue(true);
    mockEnsureInternalSocialAuth.mockReturnValue(null);
    mockGetDb.mockReturnValue(
      createDbMock({
        count: 0,
        oldest: null,
      }),
    );
  });

  it("returns 401 for unauthorized request", async () => {
    mockEnsureInternalSocialAuth.mockReturnValue(
      NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 }),
    );

    const { GET } = await import("../route");
    const response = await GET(createRequest());

    expect(response.status).toBe(401);
  });

  it("returns 503 when database is not configured", async () => {
    mockIsDatabaseConfigured.mockReturnValue(false);

    const { GET } = await import("../route");
    const response = await GET(createRequest());
    const data = await response.json();

    expect(response.status).toBe(503);
    expect(data.success).toBe(false);
    expect(String(data.error)).toContain("DATABASE_URL");
  });

  it("returns expanded ops snapshot sections including lag indicators", async () => {
    const oldest = new Date(Date.now() - 90_000);
    mockGetDb.mockReturnValue(
      createDbMock({
        count: 3,
        oldest,
      }),
    );

    const { GET } = await import("../route");
    const response = await GET(
      createRequest(
        "http://localhost:3000/api/social/internal/ops-snapshot?workspaceId=ws_1&horizonMinutes=30",
      ),
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.snapshot.workspaceId).toBe("ws_1");
    expect(data.snapshot.queueDepth).toEqual(
      expect.objectContaining({
        queuedPosts: 3,
        queuedDueNowPosts: 3,
        pendingWebhookDeliveries: 3,
      }),
    );
    expect(data.snapshot.dispatchFailures).toEqual(
      expect.objectContaining({
        failedDispatchRuns: 3,
        deadLetteredDeliveries: 3,
      }),
    );
    expect(data.snapshot.deadLetters).toEqual(
      expect.objectContaining({
        total: 3,
        replayRequested: 3,
      }),
    );
    expect(data.snapshot.refreshLeases).toEqual(
      expect.objectContaining({
        active: 3,
        expired: 3,
        released: 3,
      }),
    );
    expect(data.snapshot.workflowLag).toEqual(
      expect.objectContaining({
        oldestQueuedDuePostAgeSeconds: expect.any(Number),
        oldestPublishingPostAgeSeconds: expect.any(Number),
        oldestClaimedDispatchAgeSeconds: expect.any(Number),
        oldestPendingWebhookDeliveryAgeSeconds: expect.any(Number),
        oldestExpiredRefreshLeaseAgeSeconds: expect.any(Number),
      }),
    );
  });

  it("supports POST as snapshot trigger", async () => {
    const { POST } = await import("../route");
    const response = await POST(createRequest());
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
  });
});
