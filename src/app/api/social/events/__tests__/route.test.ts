import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const mockWithApiPermission = vi.fn();
const mockListSocialEvents = vi.fn();
const mockMarkSocialEventRead = vi.fn();

vi.mock("@/lib/db", () => ({
  isDatabaseConfigured: vi.fn(() => true),
}));

vi.mock("@/lib/studio/authz", () => ({
  withApiPermission: (...args: unknown[]) => mockWithApiPermission(...args),
  authzErrorResponse: (result: { status: number; error: string }) =>
    NextResponse.json({ success: false, error: result.error }, { status: result.status }),
}));

vi.mock("@/lib/social/repository", () => ({
  listSocialEvents: (...args: unknown[]) => mockListSocialEvents(...args),
  markSocialEventRead: (...args: unknown[]) => mockMarkSocialEventRead(...args),
  SocialEventNotFoundError: class extends Error {
    constructor(id?: string) {
      super(`Social event "${id}" not found.`);
      this.name = "SocialEventNotFoundError";
    }
  },
}));

const mockSession = {
  user: { id: "user_1", name: "Test", email: "test@example.com" },
  workspace: { id: "ws_1", organizationId: "org_1" },
  role: "owner" as const,
  planTier: "free" as const,
  permissions: ["social:view", "social:manage"],
};

function authorized() {
  mockWithApiPermission.mockResolvedValue({ authorized: true, session: mockSession });
}

function unauthorized(status: 401 | 403) {
  mockWithApiPermission.mockResolvedValue({
    authorized: false,
    response: NextResponse.json(
      { success: false, error: status === 401 ? "Unauthenticated" : "Forbidden" },
      { status },
    ),
  });
}

function request(url: string, init?: RequestInit): NextRequest {
  return new NextRequest(url, init);
}

describe("/api/social/events", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 for unauthenticated requests", async () => {
    unauthorized(401);
    const { GET } = await import("../route");
    const response = await GET(request("http://localhost:3000/api/social/events"));
    expect(response.status).toBe(401);
  });

  it("lists events with filters", async () => {
    authorized();
    mockListSocialEvents.mockResolvedValue([{ id: "sevt_1", eventType: "post.failed" }]);

    const { GET } = await import("../route");
    const response = await GET(
      request(
        "http://localhost:3000/api/social/events?userFacing=true&unreadOnly=true&limit=20&offset=5",
      ),
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(mockListSocialEvents).toHaveBeenCalledWith("ws_1", {
      userFacing: true,
      unreadOnly: true,
      limit: 20,
      offset: 5,
    });
  });
});

describe("/api/social/events/[eventId]/read", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("marks an event as read", async () => {
    authorized();
    mockMarkSocialEventRead.mockResolvedValue({
      id: "sevt_1",
      readAt: new Date(),
    });

    const { POST } = await import("../[eventId]/read/route");
    const response = await POST(
      request("http://localhost:3000/api/social/events/sevt_1/read", { method: "POST" }),
      { params: Promise.resolve({ eventId: "sevt_1" }) },
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(mockMarkSocialEventRead).toHaveBeenCalledWith("ws_1", "sevt_1");
  });

  it("returns 404 when event does not exist", async () => {
    authorized();
    const { SocialEventNotFoundError } = await import("@/lib/social/repository");
    mockMarkSocialEventRead.mockRejectedValue(new SocialEventNotFoundError("sevt_missing"));

    const { POST } = await import("../[eventId]/read/route");
    const response = await POST(
      request("http://localhost:3000/api/social/events/sevt_missing/read", { method: "POST" }),
      { params: Promise.resolve({ eventId: "sevt_missing" }) },
    );

    expect(response.status).toBe(404);
  });
});
