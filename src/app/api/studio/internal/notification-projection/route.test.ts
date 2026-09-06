import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const mocks = vi.hoisted(() => ({ authorize: vi.fn(), project: vi.fn() }));
vi.mock("@/lib/studio/internal-auth", () => ({ ensureInternalStudioOrCronAuth: (...args: unknown[]) => mocks.authorize(...args) }));
vi.mock("@/lib/product-notifications/production", () => ({ WORKSPACE_NOTIFICATION_PROJECTOR: { project: (...args: unknown[]) => mocks.project(...args) } }));
import { GET } from "./route";

describe("notification projection worker route", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.authorize.mockReturnValue(null); mocks.project.mockResolvedValue({ inspected: 4, recorded: 4, recipientsCreated: 6, failed: 0 }); });
  it("projects a bounded batch after internal authorization", async () => {
    const response = await GET(new NextRequest("http://localhost/api/studio/internal/notification-projection?limit=999"));
    expect(response.status).toBe(200);
    expect(mocks.project).toHaveBeenCalledWith(100);
  });
  it("rejects unauthorized requests before projection", async () => {
    mocks.authorize.mockReturnValue(NextResponse.json({ success: false }, { status: 401 }));
    expect((await GET(new NextRequest("http://localhost/api/studio/internal/notification-projection"))).status).toBe(401);
    expect(mocks.project).not.toHaveBeenCalled();
  });
});
