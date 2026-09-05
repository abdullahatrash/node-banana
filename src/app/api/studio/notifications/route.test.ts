import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), list: vi.fn() }));
vi.mock("@/lib/studio/authz", () => ({ withApiPermission: (...args: unknown[]) => mocks.auth(...args) }));
vi.mock("@/lib/product-notifications/production", () => ({ WORKSPACE_NOTIFICATIONS: { listForUser: (...args: unknown[]) => mocks.list(...args) } }));

import { GET } from "./route";

describe("workspace notifications route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({ authorized: true, session: { workspace: { id: "ws_1" }, user: { id: "user_1" } } });
    mocks.list.mockResolvedValue([]);
  });

  it("lists only the authenticated billing reader's workspace projection", async () => {
    const response = await GET(new NextRequest("http://localhost/api/studio/notifications?unreadOnly=true&limit=999"));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(mocks.auth).toHaveBeenCalledWith(expect.anything(), { route: "/api/studio/notifications", permission: "product:billing:read" });
    expect(mocks.list).toHaveBeenCalledWith({ workspaceId: "ws_1", userId: "user_1", unreadOnly: true, limit: 100 });
  });

  it("returns the authorization response without querying notifications", async () => {
    mocks.auth.mockResolvedValue({ authorized: false, response: NextResponse.json({ success: false }, { status: 403 }) });
    expect((await GET(new NextRequest("http://localhost/api/studio/notifications"))).status).toBe(403);
    expect(mocks.list).not.toHaveBeenCalled();
  });
});
