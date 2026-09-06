import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), configured: vi.fn(), run: vi.fn() }));
vi.mock("@/lib/db", () => ({ isDatabaseConfigured: () => mocks.configured() }));
vi.mock("@/lib/studio/internal-auth", () => ({ ensureInternalStudioOrCronAuth: (...args: unknown[]) => mocks.auth(...args) }));
vi.mock("@/lib/product-surfaces/trend-ingestion-repository", () => ({ PRODUCTION_TREND_INGESTION_WORKER: { run: (...args: unknown[]) => mocks.run(...args) } }));

import { GET, POST } from "./route";

describe("inspiration trend ingestion route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockReturnValue(null);
    mocks.configured.mockReturnValue(true);
    mocks.run.mockResolvedValue({ scheduled: 0, claimed: 0, succeeded: 0 });
  });

  it("authenticates before revealing configuration or invoking the worker", async () => {
    mocks.auth.mockReturnValue(NextResponse.json({ success: false }, { status: 401 }));
    const response = await GET(new NextRequest("http://localhost/api/studio/internal/inspiration-trends"));
    expect(response.status).toBe(401);
    expect(mocks.configured).not.toHaveBeenCalled();
    expect(mocks.run).not.toHaveBeenCalled();
  });

  it("fails closed when durable storage is unavailable", async () => {
    mocks.configured.mockReturnValue(false);
    const response = await POST(new NextRequest("http://localhost/api/studio/internal/inspiration-trends", { method: "POST" }));
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(mocks.run).not.toHaveBeenCalled();
  });

  it("bounds work and returns a no-store summary", async () => {
    const response = await GET(new NextRequest("http://localhost/api/studio/internal/inspiration-trends?limit=999", { headers: { "x-vercel-id": "cron-run-1" } }));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(mocks.run).toHaveBeenCalledWith({ workerId: "cron-run-1", limit: 100 });
    await expect(response.json()).resolves.toMatchObject({ success: true, summary: { scheduled: 0, claimed: 0 } });
  });
});
