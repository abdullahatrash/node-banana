import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), setRead: vi.fn() }));
vi.mock("@/lib/studio/authz", () => ({ withApiPermission: (...args: unknown[]) => mocks.auth(...args) }));
vi.mock("@/lib/product-notifications/production", () => ({ WORKSPACE_NOTIFICATIONS: { setRead: (...args: unknown[]) => mocks.setRead(...args) } }));

import { DELETE, POST } from "./route";

describe("workspace notification read state route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({ authorized: true, session: { workspace: { id: "ws_1" }, user: { id: "user_1" } } });
    mocks.setRead.mockImplementation(async (value) => ({ eventId: value.eventId, read: value.read }));
  });

  it("marks only the authenticated recipient read or unread", async () => {
    const context = { params: Promise.resolve({ eventId: "event_1" }) };
    expect((await POST(new NextRequest("http://localhost/api/studio/notifications/event_1/read", { method: "POST" }), context)).status).toBe(200);
    expect(mocks.setRead).toHaveBeenCalledWith({ workspaceId: "ws_1", eventId: "event_1", userId: "user_1", read: true });
    expect((await DELETE(new NextRequest("http://localhost/api/studio/notifications/event_1/read", { method: "DELETE" }), context)).status).toBe(200);
    expect(mocks.setRead).toHaveBeenCalledWith({ workspaceId: "ws_1", eventId: "event_1", userId: "user_1", read: false });
  });
});
