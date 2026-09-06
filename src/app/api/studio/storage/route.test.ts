import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const authorize = vi.fn();
const summary = vi.fn();
vi.mock("@/lib/db", () => ({ isDatabaseConfigured: () => true }));
vi.mock("@/lib/studio/authz", () => ({
  authorizeStudioRequest: (...args: unknown[]) => authorize(...args),
  authzErrorResponse: (result: { status: number; error: string }) => NextResponse.json({ success: false, error: result.error }, { status: result.status }),
}));
vi.mock("@/lib/studio/repository", () => ({ getWorkspaceStorageSummary: (...args: unknown[]) => summary(...args) }));

import { GET } from "./route";

describe("GET /api/studio/storage", () => {
  beforeEach(() => vi.clearAllMocks());
  it("returns only the authorized workspace storage projection", async () => {
    authorize.mockResolvedValue({ authorized: true, userId: "user-1", workspaceId: "workspace-1", role: "member" });
    summary.mockResolvedValue({ quotaBytes: 100, usedBytes: 25, pendingReservedBytes: 5, activeAssetCount: 2, recoverableDeletedBytes: 10, recoverableDeletedCount: 1, byType: [], measuredAt: "2026-09-04T00:00:00.000Z" });
    const response = await GET(new NextRequest("http://localhost/api/studio/storage"), undefined);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(summary).toHaveBeenCalledWith("workspace-1");
    expect(authorize).toHaveBeenCalledWith(expect.anything(), { route: "/api/studio/storage", action: "read", permission: "assets:read" });
  });

  it("rejects unauthenticated access", async () => {
    authorize.mockResolvedValue({ authorized: false, status: 401, error: "Sign in", reason: "unauthenticated" });
    expect((await GET(new NextRequest("http://localhost/api/studio/storage"), undefined)).status).toBe(401);
    expect(summary).not.toHaveBeenCalled();
  });
});
