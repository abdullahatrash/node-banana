import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mockIsDatabaseConfigured = vi.fn(() => true);
const mockListExpiringSocialAccounts = vi.fn();
const mockWorkflowStart = vi.fn();

vi.mock("@/lib/db", () => ({
  isDatabaseConfigured: (...args: unknown[]) => mockIsDatabaseConfigured(...(args as [])),
}));

vi.mock("@/lib/social/repository", () => ({
  listExpiringSocialAccounts: (...args: unknown[]) =>
    mockListExpiringSocialAccounts(...args),
}));

vi.mock("workflow/api", () => ({
  start: (...args: unknown[]) => mockWorkflowStart(...args),
}));

vi.mock("@/utils/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

function createRequest(
  url = "http://localhost:3000/api/social/internal/token-refresh-dispatch",
): NextRequest {
  return new NextRequest(url, {
    method: "POST",
    headers: {
      "x-social-internal-secret": "secret_123",
    },
  });
}

describe("/api/social/internal/token-refresh-dispatch POST", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SOCIAL_INTERNAL_API_SECRET = "secret_123";
    delete process.env.SOCIAL_TOKEN_REFRESH_BUFFER_MINUTES;
    delete process.env.SOCIAL_TOKEN_REFRESH_BATCH_SIZE;
  });

  it("returns 401 for unauthorized request", async () => {
    const { POST } = await import("../route");
    const request = new NextRequest(
      "http://localhost:3000/api/social/internal/token-refresh-dispatch",
      {
        method: "POST",
      },
    );

    const response = await POST(request);
    expect(response.status).toBe(401);
  });

  it("dispatches token refresh workflows for expiring accounts", async () => {
    mockListExpiringSocialAccounts.mockResolvedValue([
      { id: "sacct_1" },
      { id: "sacct_2" },
    ]);
    mockWorkflowStart.mockResolvedValue({ runId: "run_123" });

    const { POST } = await import("../route");
    const response = await POST(
      createRequest(
        "http://localhost:3000/api/social/internal/token-refresh-dispatch?batch=10&bufferMinutes=30",
      ),
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.summary).toEqual({
      scanned: 2,
      dispatched: 2,
      failed: 0,
    });
    expect(mockListExpiringSocialAccounts).toHaveBeenCalledWith({
      expiresBefore: expect.any(Date),
      limit: 10,
    });
    expect(mockWorkflowStart).toHaveBeenNthCalledWith(1, expect.any(Function), ["sacct_1"]);
    expect(mockWorkflowStart).toHaveBeenNthCalledWith(2, expect.any(Function), ["sacct_2"]);
  });

  it("counts workflow dispatch failures", async () => {
    mockListExpiringSocialAccounts.mockResolvedValue([
      { id: "sacct_1" },
      { id: "sacct_2" },
    ]);
    mockWorkflowStart
      .mockRejectedValueOnce(new Error("dispatch failed"))
      .mockResolvedValueOnce({ runId: "run_2" });

    const { POST } = await import("../route");
    const response = await POST(createRequest());
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.summary).toEqual({
      scanned: 2,
      dispatched: 1,
      failed: 1,
    });
  });

  it("supports GET as a cron-triggered token refresh dispatch", async () => {
    mockListExpiringSocialAccounts.mockResolvedValue([]);

    const { GET } = await import("../route");
    const response = await GET(createRequest());
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
  });
});
