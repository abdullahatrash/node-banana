import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), dispatch: vi.fn() }));
vi.mock("@/lib/studio/internal-auth", () => ({ ensureInternalStudioOrCronAuth: (...args: unknown[]) => mocks.auth(...args) }));
vi.mock("@/lib/product-notifications/production", () => ({ WORKSPACE_NOTIFICATIONS: { dispatchEmail: (...args: unknown[]) => mocks.dispatch(...args) } }));

import { GET, POST } from "./route";

describe("workspace notification email worker route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockReturnValue(null);
    mocks.dispatch.mockResolvedValue({ inspected: 0, delivered: 0, suppressed: 0, retryScheduled: 0, failedKnown: 0, outcomeUnknown: 0 });
  });

  it.each([GET, POST])("requires internal or scheduler authentication", async (handler) => {
    mocks.auth.mockReturnValue(NextResponse.json({ success: false }, { status: 401 }));
    expect((await handler(new NextRequest("http://localhost/api/studio/internal/notification-email"))).status).toBe(401);
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });

  it("caps a worker page and returns a no-store summary", async () => {
    const response = await GET(new NextRequest("http://localhost/api/studio/internal/notification-email?limit=500"));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(mocks.dispatch).toHaveBeenCalledWith(20);
  });
});
