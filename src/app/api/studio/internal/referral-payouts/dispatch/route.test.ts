import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { readFileSync } from "node:fs";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), reconcile: vi.fn() }));
vi.mock("@/lib/studio/internal-auth", () => ({ ensureInternalStudioOrCronAuth: (...args: unknown[]) => mocks.auth(...args) }));
vi.mock("@/lib/commercial/production", () => ({ REFERRAL_PAYOUT_DISPATCH: { reconcile: (...args: unknown[]) => mocks.reconcile(...args) } }));

import { GET, POST } from "./route";

describe("referral payout dispatch route", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.auth.mockReturnValue(null);
    mocks.reconcile.mockResolvedValue({ inspected: 0, submitted: 0, reconciled: 0, pending: 0, actionRequired: 0, paid: 0, failedKnown: 0, outcomeUnknown: 0, retryScheduled: 0, unavailable: 0 });
  });

  it.each([GET, POST])("requires internal or scheduler authentication", async (handler) => {
    mocks.auth.mockReturnValue(NextResponse.json({ success: false }, { status: 401 }));
    const response = await handler(new NextRequest("http://localhost/api/studio/internal/referral-payouts/dispatch"));
    expect(response.status).toBe(401);
    expect(mocks.reconcile).not.toHaveBeenCalled();
  });

  it("bounds work and returns a no-store summary", async () => {
    const response = await GET(new NextRequest("http://localhost/api/studio/internal/referral-payouts/dispatch?limit=999"));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(mocks.reconcile).toHaveBeenCalledWith(20);
    await expect(response.json()).resolves.toMatchObject({ success: true, result: { inspected: 0, paid: 0 } });
  });

  it("is scheduled in production and included in the local worker pass", () => {
    const deployment = JSON.parse(readFileSync("vercel.json", "utf8")) as { functions: Record<string, unknown>; crons: Array<{ path: string; schedule: string }> };
    expect(deployment.functions).toHaveProperty("src/app/api/studio/internal/referral-payouts/dispatch/route.ts");
    expect(deployment.crons).toContainEqual({ path: "/api/studio/internal/referral-payouts/dispatch?limit=20", schedule: "* * * * *" });
    expect(readFileSync("scripts/run-local-content-workers.mjs", "utf8")).toContain('["referral-payouts", "/api/studio/internal/referral-payouts/dispatch?limit=20"]');
  });
});
