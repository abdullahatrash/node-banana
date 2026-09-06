import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { defaultSocialNotificationPreferences } from "@/lib/social/notification-preferences";

const mockIsDatabaseConfigured = vi.fn(() => true);
const mockSelect = vi.fn();
const mockGetSocialNotificationPreferences = vi.fn();
const mockMarkSocialEventReadForUser = vi.fn();

class MockSocialNotificationPreferencesNotFoundError extends Error {
  constructor(userId: string) {
    super(`Social notification preferences for user "${userId}" not found.`);
    this.name = "SocialNotificationPreferencesNotFoundError";
  }
}

vi.mock("@/lib/db", () => ({
  isDatabaseConfigured: (...args: unknown[]) => mockIsDatabaseConfigured(...(args as [])),
  getDb: () => ({
    select: mockSelect,
  }),
}));

vi.mock("@/lib/social/repository", () => ({
  getSocialNotificationPreferences: (...args: unknown[]) =>
    mockGetSocialNotificationPreferences(...args),
  markSocialEventReadForUser: (...args: unknown[]) =>
    mockMarkSocialEventReadForUser(...args),
  SocialNotificationPreferencesNotFoundError:
    MockSocialNotificationPreferencesNotFoundError,
}));

function mockEvents(rows: Array<Record<string, unknown>>) {
  const limit = vi.fn().mockResolvedValue(rows);
  const orderBy = vi.fn().mockReturnValue({ limit });
  const where = vi.fn().mockReturnValue({ orderBy });
  const from = vi.fn().mockReturnValue({ where });
  mockSelect.mockReturnValue({ from });
}

function createRequest(url = "http://localhost:3000/api/social/internal/digest-dispatch") {
  return new NextRequest(url, {
    method: "GET",
    headers: {
      "x-social-internal-secret": "secret_123",
    },
  });
}

describe("/api/social/internal/digest-dispatch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SOCIAL_INTERNAL_API_SECRET = "secret_123";
  });

  it("returns 401 for unauthorized request", async () => {
    const { GET } = await import("../route");
    const request = new NextRequest(
      "http://localhost:3000/api/social/internal/digest-dispatch",
      { method: "GET" },
    );

    const response = await GET(request);
    expect(response.status).toBe(401);
  });

  it("groups eligible events by recipient and applies preference filtering", async () => {
    mockEvents([
      {
        id: "sevt_1",
        workspaceId: "ws_1",
        eventType: "post.failed",
        message: "Post failed",
        createdByUserId: "user_1",
        createdAt: new Date(),
        dispatchKey: "dispatch:1",
      },
      {
        id: "sevt_2",
        workspaceId: "ws_1",
        eventType: "post.failed",
        message: "Post failed",
        createdByUserId: "user_1",
        createdAt: new Date(),
        dispatchKey: "dispatch:2",
      },
      {
        id: "sevt_3",
        workspaceId: "ws_1",
        eventType: "token.refreshed",
        message: "Token refreshed",
        createdByUserId: "user_2",
        createdAt: new Date(),
        dispatchKey: "dispatch:3",
      },
    ]);
    mockGetSocialNotificationPreferences
      .mockResolvedValueOnce({
        muteAll: false,
        inAppEnabled: true,
        emailEnabled: false,
      })
      .mockResolvedValueOnce({
        muteAll: true,
        inAppEnabled: true,
        emailEnabled: true,
      });

    const { GET } = await import("../route");
    const response = await GET(createRequest());
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.summary.digests).toBe(1);
    expect(data.digests).toEqual([
      expect.objectContaining({
        recipientKey: "user:user_1",
        userId: "user_1",
        channels: ["in_app", "email"],
        count: 2,
        deliveryLocale: "ar",
        digestCadence: "daily",
      }),
    ]);
  });

  it("marks digest events as read per user when consume=true", async () => {
    mockEvents([
      {
        id: "sevt_1",
        workspaceId: "ws_1",
        eventType: "post.failed",
        message: "Post failed",
        createdByUserId: "user_1",
        createdAt: new Date(),
        dispatchKey: "dispatch:1",
      },
    ]);
    mockGetSocialNotificationPreferences.mockRejectedValue(
      new MockSocialNotificationPreferencesNotFoundError("user_1"),
    );
    mockMarkSocialEventReadForUser.mockResolvedValue({});

    const { POST } = await import("../route");
    const request = new NextRequest(
      "http://localhost:3000/api/social/internal/digest-dispatch?consume=true",
      {
        method: "POST",
        headers: {
          "x-social-internal-secret": "secret_123",
        },
      },
    );
    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.summary.consumed).toBe(1);
    expect(mockMarkSocialEventReadForUser).toHaveBeenCalledWith({
      workspaceId: "ws_1",
      eventId: "sevt_1",
      userId: "user_1",
    });
  });

  it("does not reuse one user's preferences across Workspaces", async () => {
    mockEvents([
      { id: "sevt_1", workspaceId: "ws_1", eventType: "post.published", message: "Published one", createdByUserId: "user_1", createdAt: new Date(), dispatchKey: "dispatch:1" },
      { id: "sevt_2", workspaceId: "ws_2", eventType: "post.published", message: "Published two", createdByUserId: "user_1", createdAt: new Date(), dispatchKey: "dispatch:2" },
    ]);
    mockGetSocialNotificationPreferences
      .mockResolvedValueOnce({ muteAll: false, inAppEnabled: true, emailEnabled: false, preferences: null })
      .mockResolvedValueOnce({ muteAll: true, inAppEnabled: true, emailEnabled: true, preferences: null });

    const { GET } = await import("../route");
    const data = await (await GET(createRequest())).json();
    expect(mockGetSocialNotificationPreferences).toHaveBeenNthCalledWith(1, "ws_1", "user_1");
    expect(mockGetSocialNotificationPreferences).toHaveBeenNthCalledWith(2, "ws_2", "user_1");
    expect(data.digests).toHaveLength(1);
    expect(data.digests[0].workspaceId).toBe("ws_1");
  });

  it("keeps optional events unread until the selected weekly email tick is due", async () => {
    mockEvents([{ id: "sevt_1", workspaceId: "ws_1", eventType: "post.published", message: "Published", createdByUserId: "user_1", createdAt: new Date(), dispatchKey: "dispatch:1" }]);
    const preferences = defaultSocialNotificationPreferences({ locale: "en", timeZone: "UTC" });
    preferences.digestCadence = "weekly";
    preferences.weeklyDigestDay = 1;
    preferences.quietHours.enabled = false;
    mockGetSocialNotificationPreferences.mockResolvedValue({ muteAll: false, inAppEnabled: true, emailEnabled: true, preferences });
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-06T13:00:00.000Z"));
    try {
      const { POST } = await import("../route");
      const request = new NextRequest("http://localhost:3000/api/social/internal/digest-dispatch?consume=true", { method: "POST", headers: { "x-social-internal-secret": "secret_123" } });
      const data = await (await POST(request)).json();
      expect(data.digests).toEqual([]);
      expect(mockMarkSocialEventReadForUser).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });
});
