import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const mockWithApiPermission = vi.fn();
const mockGetSocialNotificationPreferences = vi.fn();
const mockUpsertSocialNotificationPreferences = vi.fn();

class MockSocialNotificationPreferencesNotFoundError extends Error {
  constructor(userId: string) {
    super(`Social notification preferences for user "${userId}" not found.`);
    this.name = "SocialNotificationPreferencesNotFoundError";
  }
}

vi.mock("@/lib/db", () => ({
  isDatabaseConfigured: vi.fn(() => true),
}));

vi.mock("@/lib/studio/authz", () => ({
  withApiPermission: mockWithApiPermission,
  authzErrorResponse: (result: { status: number; error: string }) =>
    NextResponse.json(
      {
        success: false,
        error: result.error,
      },
      { status: result.status },
    ),
}));

vi.mock("@/lib/social/repository", () => ({
  getSocialNotificationPreferences: mockGetSocialNotificationPreferences,
  upsertSocialNotificationPreferences: mockUpsertSocialNotificationPreferences,
  SocialNotificationPreferencesNotFoundError:
    MockSocialNotificationPreferencesNotFoundError,
}));

function createRequest(url: string, init?: RequestInit) {
  return new NextRequest(url, init);
}

const mockSession = {
  user: { id: "user_1", name: "Test", email: "test@example.com" },
  workspace: { id: "ws_1", organizationId: "org_1" },
  role: "owner" as const,
  planTier: "pro" as const,
  permissions: ["social:view"],
};

function authorized() {
  mockWithApiPermission.mockResolvedValue({
    authorized: true,
    session: mockSession,
  });
}

function unauthorized(status: 401 | 403) {
  mockWithApiPermission.mockResolvedValue({
    authorized: false,
    response: NextResponse.json(
      {
        success: false,
        error: status === 401 ? "Unauthenticated" : "Forbidden",
      },
      { status },
    ),
  });
}

describe("/api/social/notifications/preferences", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 for unauthenticated requests", async () => {
    unauthorized(401);
    const { GET } = await import("../route");
    const response = await GET(
      createRequest("http://localhost:3000/api/social/notifications/preferences"),
    );
    expect(response.status).toBe(401);
  });

  it("returns defaults when preferences do not exist", async () => {
    authorized();
    mockGetSocialNotificationPreferences.mockRejectedValue(
      new MockSocialNotificationPreferencesNotFoundError("user_1"),
    );

    const { GET } = await import("../route");
    const response = await GET(
      createRequest("http://localhost:3000/api/social/notifications/preferences"),
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.preferences).toEqual({
      workspaceId: "ws_1",
      userId: "user_1",
      inAppEnabled: true,
      emailEnabled: false,
      webhookEnabled: false,
      muteAll: false,
      preferences: null,
    });
  });

  it("returns 400 when toggle fields are invalid", async () => {
    authorized();

    const { PUT } = await import("../route");
    const response = await PUT(
      createRequest("http://localhost:3000/api/social/notifications/preferences", {
        method: "PUT",
        body: JSON.stringify({
          inAppEnabled: "yes",
        }),
      }),
    );
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
  });

  it("upserts notification preferences", async () => {
    authorized();
    mockUpsertSocialNotificationPreferences.mockResolvedValue({
      workspaceId: "ws_1",
      userId: "user_1",
      inAppEnabled: false,
      emailEnabled: true,
      webhookEnabled: false,
      muteAll: false,
      preferences: { severities: ["error"] },
    });

    const { PUT } = await import("../route");
    const response = await PUT(
      createRequest("http://localhost:3000/api/social/notifications/preferences", {
        method: "PUT",
        body: JSON.stringify({
          inAppEnabled: false,
          emailEnabled: true,
          preferences: { severities: ["error"] },
        }),
      }),
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(mockUpsertSocialNotificationPreferences).toHaveBeenCalledWith({
      workspaceId: "ws_1",
      userId: "user_1",
      inAppEnabled: false,
      emailEnabled: true,
      webhookEnabled: undefined,
      muteAll: undefined,
      preferences: { severities: ["error"] },
    });
  });
});
