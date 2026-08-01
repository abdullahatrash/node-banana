import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mockConfigured = vi.fn(() => true);
const mockExpireAndDrain = vi.fn();

vi.mock("@/lib/db", () => ({
  isDatabaseConfigured: () => mockConfigured(),
}));
vi.mock("@/lib/agent-runtime/observability/support-bundles-production", () => ({
  getSupportBundleApplication: () => ({ expireAndDrain: mockExpireAndDrain }),
}));

function request(secret = "internal_secret", limit = 10, maxPages?: number) {
  const pages = maxPages === undefined ? "" : `&maxPages=${maxPages}`;
  return new NextRequest(
    `http://localhost/api/studio/internal/observability-retention?limit=${limit}${pages}`,
    {
      method: "POST",
      headers: { "x-studio-internal-secret": secret },
    },
  );
}

function cronRequest(secret = "cron_secret", limit = 10) {
  return new NextRequest(
    `http://localhost/api/studio/internal/observability-retention?limit=${limit}`,
    {
      method: "GET",
      headers: { authorization: `Bearer ${secret}` },
    },
  );
}

describe("observability retention maintenance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConfigured.mockReturnValue(true);
    process.env.STUDIO_INTERNAL_API_SECRET = "internal_secret";
    process.env.CRON_SECRET = "cron_secret";
    mockExpireAndDrain.mockResolvedValue({
      intents: { scanned: 0, bound: 0, abandoned: 0, errors: 0 },
      expired: { traces: 1, metrics: 2, bundles: 1, grants: 0 },
      cleanup: { scanned: 1, deleted: 1, acknowledged: 1, errors: 0 },
    });
  });

  it("requires hardened internal authentication", async () => {
    const { POST } = await import("./route");
    expect((await POST(request("wrong"))).status).toBe(401);
    expect(mockExpireAndDrain).not.toHaveBeenCalled();
  });

  it("does not disclose database configuration before authentication", async () => {
    mockConfigured.mockReturnValue(false);
    const { POST } = await import("./route");
    expect((await POST(request("wrong"))).status).toBe(401);
    expect(mockConfigured).not.toHaveBeenCalled();
  });

  it("runs bounded expiry and acknowledged cleanup with no-store output", async () => {
    const { POST } = await import("./route");
    const response = await POST(request("internal_secret", 500));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(mockExpireAndDrain).toHaveBeenCalledWith({
      at: expect.any(Date),
      limit: 100,
    });
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      summary: {
        pages: 1,
        continuationRequired: false,
        stoppedBecause: "drained",
      },
    });
  });

  it("drains successive pages and accumulates their summaries", async () => {
    mockExpireAndDrain
      .mockResolvedValueOnce({
        intents: { scanned: 2, bound: 2, abandoned: 0, errors: 0 },
        expired: { traces: 2, metrics: 1, bundles: 2, grants: 0 },
        cleanup: { scanned: 2, deleted: 2, acknowledged: 2, errors: 0 },
      })
      .mockResolvedValueOnce({
        intents: { scanned: 1, bound: 1, abandoned: 0, errors: 0 },
        expired: { traces: 1, metrics: 0, bundles: 1, grants: 0 },
        cleanup: { scanned: 1, deleted: 1, acknowledged: 1, errors: 0 },
      });

    const { POST } = await import("./route");
    const response = await POST(request("internal_secret", 2));

    expect(mockExpireAndDrain).toHaveBeenCalledTimes(2);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      summary: {
        pages: 2,
        intents: { scanned: 3, bound: 3, errors: 0 },
        expired: { traces: 3, metrics: 1, bundles: 3, grants: 0 },
        cleanup: { scanned: 3, deleted: 3, acknowledged: 3, errors: 0 },
        continuationRequired: false,
        stoppedBecause: "drained",
      },
    });
  });

  it("returns a continuation signal when the iteration bound is reached", async () => {
    mockExpireAndDrain.mockResolvedValue({
      intents: { scanned: 2, bound: 2, abandoned: 0, errors: 0 },
      expired: { traces: 2, metrics: 2, bundles: 2, grants: 2 },
      cleanup: { scanned: 2, deleted: 2, acknowledged: 2, errors: 0 },
    });

    const { POST } = await import("./route");
    const response = await POST(request("internal_secret", 2, 2));

    expect(response.status).toBe(200);
    expect(mockExpireAndDrain).toHaveBeenCalledTimes(2);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      summary: {
        pages: 2,
        continuationRequired: true,
        stoppedBecause: "iteration_limit",
      },
    });
  });

  it("runs scheduled GET maintenance authenticated by Vercel CRON_SECRET", async () => {
    delete process.env.STUDIO_INTERNAL_API_SECRET;
    const { GET } = await import("./route");
    const response = await GET(cronRequest("cron_secret", 25));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(mockExpireAndDrain).toHaveBeenCalledWith({
      at: expect.any(Date),
      limit: 25,
    });
  });

  it("rejects a scheduled GET with an invalid cron secret", async () => {
    const { GET } = await import("./route");
    const response = await GET(cronRequest("wrong_cron_secret"));

    expect(response.status).toBe(401);
    expect(mockExpireAndDrain).not.toHaveBeenCalled();
  });

  it("returns retryable failure when storage deletion is not acknowledged", async () => {
    mockExpireAndDrain.mockResolvedValueOnce({
      intents: { scanned: 0, bound: 0, abandoned: 0, errors: 0 },
      expired: { traces: 0, metrics: 0, bundles: 1, grants: 0 },
      cleanup: { scanned: 1, deleted: 0, acknowledged: 0, errors: 1 },
    });
    const { POST } = await import("./route");
    const failed = await POST(request());
    expect(failed.status).toBe(503);
    await expect(failed.json()).resolves.toMatchObject({
      code: "OBSERVABILITY_RETENTION_UNAVAILABLE",
      summary: { cleanup: { errors: 1, acknowledged: 0 } },
    });

    const retried = await POST(request());
    expect(retried.status).toBe(200);
    expect(mockExpireAndDrain).toHaveBeenCalledTimes(2);
  });

  it("aggregates page errors while continuing physical cleanup", async () => {
    mockExpireAndDrain
      .mockResolvedValueOnce({
        intents: { scanned: 2, bound: 1, abandoned: 0, errors: 1 },
        expired: { traces: 2, metrics: 2, bundles: 2, grants: 2 },
        cleanup: { scanned: 2, deleted: 1, acknowledged: 1, errors: 1 },
      })
      .mockResolvedValueOnce({
        intents: { scanned: 1, bound: 0, abandoned: 0, errors: 1 },
        expired: { traces: 0, metrics: 0, bundles: 0, grants: 0 },
        cleanup: { scanned: 1, deleted: 0, acknowledged: 0, errors: 1 },
      });

    const { POST } = await import("./route");
    const response = await POST(request("internal_secret", 2));

    expect(response.status).toBe(503);
    expect(mockExpireAndDrain).toHaveBeenCalledTimes(2);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      summary: {
        pages: 2,
        intents: { errors: 2 },
        cleanup: { scanned: 3, errors: 2 },
        continuationRequired: true,
        stoppedBecause: "partial_failure",
      },
    });
  });

  it("returns a no-store retryable failure when maintenance throws", async () => {
    mockExpireAndDrain.mockRejectedValueOnce(new Error("sensitive storage detail"));
    const { POST } = await import("./route");
    const response = await POST(request());

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toContain("no-store");
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      code: "OBSERVABILITY_RETENTION_UNAVAILABLE",
      error: "Observability retention cleanup is temporarily unavailable.",
      summary: {
        pages: 0,
        invocationErrors: 1,
        continuationRequired: true,
        stoppedBecause: "error",
      },
    });
  });
});
