import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const authorizeStudioRequest = vi.fn();
const listCanonicalCalendar = vi.fn();

vi.mock("@/lib/db", () => ({ isDatabaseConfigured: () => true }));
vi.mock("@/lib/studio/authz", () => ({
  authorizeStudioRequest: (...args: unknown[]) => authorizeStudioRequest(...args),
  authzErrorResponse: (result: { status: number; error: string }) =>
    NextResponse.json({ success: false, error: result.error }, { status: result.status }),
}));
vi.mock("@/lib/product-surfaces/calendar-projection-production", () => ({
  listCanonicalCalendar: (...args: unknown[]) => listCanonicalCalendar(...args),
}));

import { GET } from "../route";

describe("GET /api/studio/calendar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authorizeStudioRequest.mockResolvedValue({
      authorized: true,
      workspaceId: "workspace_1",
      userId: "user_1",
      role: "member",
      authContextId: "session_1",
    });
    listCanonicalCalendar.mockResolvedValue([{ id: "canonical:plan_1:target_1" }]);
  });

  it("returns the no-store canonical projection for the authorized Workspace", async () => {
    const response = await GET(new NextRequest(
      "http://localhost:3000/api/studio/calendar?start=2026-09-01T00%3A00%3A00.000Z&end=2026-09-30T23%3A59%3A59.999Z&socialAccountId=channel_1",
      { headers: { "x-workspace-id": "workspace_1" } },
    ));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({
      success: true,
      schema: "calendar-projection/v1",
      items: [{ id: "canonical:plan_1:target_1" }],
    });
    expect(listCanonicalCalendar).toHaveBeenCalledWith({
      workspaceId: "workspace_1",
      start: new Date("2026-09-01T00:00:00.000Z"),
      end: new Date("2026-09-30T23:59:59.999Z"),
      socialAccountId: "channel_1",
    });
  });

  it("rejects malformed or excessively broad ranges before repository access", async () => {
    const malformed = await GET(new NextRequest(
      "http://localhost:3000/api/studio/calendar?start=nope&end=2026-09-30T23%3A59%3A59.999Z",
      { headers: { "x-workspace-id": "workspace_1" } },
    ));
    const broad = await GET(new NextRequest(
      "http://localhost:3000/api/studio/calendar?start=2026-01-01T00%3A00%3A00.000Z&end=2027-12-31T23%3A59%3A59.999Z",
      { headers: { "x-workspace-id": "workspace_1" } },
    ));
    expect(malformed.status).toBe(400);
    expect(broad.status).toBe(400);
    expect(listCanonicalCalendar).not.toHaveBeenCalled();
  });
});
