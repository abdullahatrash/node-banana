import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), reconcile: vi.fn() }));
vi.mock("@/lib/studio/internal-auth", () => ({ ensureInternalStudioOrCronAuth: (...args: unknown[]) => mocks.auth(...args) }));
vi.mock("@/lib/commercial/production", () => ({ MERCHANT_ADJUSTMENT_INBOX: { reconcile: (...args: unknown[]) => mocks.reconcile(...args) } }));

import { GET, POST } from "./route";

describe("merchant adjustment recovery route", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.auth.mockReturnValue(null);
    mocks.reconcile.mockResolvedValue({ inspected: 0, applied: 0, pendingDependency: 0, retryScheduled: 0, failedKnown: 0, outcomeUnknown: 0 });
  });

  it.each([GET, POST])("requires internal or scheduler authentication", async (handler) => {
    mocks.auth.mockReturnValue(NextResponse.json({ success: false }, { status: 401 }));
    const response = await handler(new NextRequest("http://localhost/api/studio/internal/reconcile-merchant-adjustments"));
    expect(response.status).toBe(401);
    expect(mocks.reconcile).not.toHaveBeenCalled();
  });

  it("bounds a recovery page and returns a no-store summary", async () => {
    const response = await GET(new NextRequest("http://localhost/api/studio/internal/reconcile-merchant-adjustments?limit=999"));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(mocks.reconcile).toHaveBeenCalledWith(20);
    await expect(response.json()).resolves.toMatchObject({ success: true, result: { inspected: 0, applied: 0, pendingDependency: 0 } });
  });
});
