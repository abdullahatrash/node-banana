import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), configured: vi.fn(), sweep: vi.fn() }));
vi.mock("@/lib/db", () => ({ isDatabaseConfigured: () => mocks.configured() }));
vi.mock("@/lib/studio/internal-auth", () => ({ ensureInternalStudioOrCronAuth: (...args: unknown[]) => mocks.auth(...args) }));
vi.mock("@/lib/governance/sweeper", () => ({ runProductionGovernanceSweep: (...args: unknown[]) => mocks.sweep(...args) }));

import { GET } from "./route";

describe("governance sweep route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.configured.mockReturnValue(true);
    mocks.auth.mockReturnValue(null);
    mocks.sweep.mockResolvedValue({ workspaces: 1, examined: 3, dispatched: 2, failed: 0, deadlinesAdvanced: 1, membershipProjection: { scanned: 1, succeeded: 1, retryPending: 0, deadLetter: 0 }, expiredSecretDeliveriesPurged: 2 });
  });

  it("requires internal or scheduler authentication before dispatch", async () => {
    mocks.auth.mockReturnValue(NextResponse.json({ success: false }, { status: 401 }));
    const response = await GET(new NextRequest("http://localhost/api/studio/internal/governance-sweep"));
    expect(response.status).toBe(401);
    expect(mocks.sweep).not.toHaveBeenCalled();
  });

  it("bounds recovery input and invokes the production sweep", async () => {
    const response = await GET(new NextRequest("http://localhost/api/studio/internal/governance-sweep?workspaces=9999&jobs=9999"));
    expect(response.status).toBe(200);
    expect(mocks.sweep).toHaveBeenCalledWith({ workspaceLimit: 500, maxJobsPerWorkspace: 1000 });
  });
});
