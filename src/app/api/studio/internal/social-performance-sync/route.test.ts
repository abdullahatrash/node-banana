import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), configured: vi.fn(), run: vi.fn() }));
vi.mock("@/lib/db", () => ({ isDatabaseConfigured: () => mocks.configured() }));
vi.mock("@/lib/studio/internal-auth", () => ({ ensureInternalStudioOrCronAuth: (...args: unknown[]) => mocks.auth(...args) }));
vi.mock("@/lib/product-surfaces/social-performance-sync", () => ({ runPerformanceSyncWorker: (...args: unknown[]) => mocks.run(...args) }));

import { GET } from "./route";

describe("social performance sync worker route", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.auth.mockReturnValue(null); mocks.configured.mockReturnValue(true); mocks.run.mockResolvedValue({ scheduled: 1, claimed: 1, succeeded: 1 }); });

  it("authenticates before touching durable state", async () => {
    mocks.auth.mockReturnValue(NextResponse.json({ success: false }, { status: 401 }));
    const response = await GET(new NextRequest("http://localhost/api/studio/internal/social-performance-sync"));
    expect(response.status).toBe(401);
    expect(mocks.run).not.toHaveBeenCalled();
  });

  it("bounds batches and returns a no-store worker summary", async () => {
    const response = await GET(new NextRequest("http://localhost/api/studio/internal/social-performance-sync?limit=999", { headers: { "x-vercel-id": "worker-1" } }));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(mocks.run).toHaveBeenCalledWith({ workerId: "worker-1", limit: 100 });
  });
});
