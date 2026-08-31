import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

import { getPermissionsForRole } from "@/lib/studio/authz";

const {
  mockAuthorize,
  mockIsDatabaseConfigured,
  mockGetSocialPost,
  MockSocialPostNotFoundError,
} = vi.hoisted(() => {
  class MockSocialPostNotFoundError extends Error {}
  return {
    mockAuthorize: vi.fn(),
    mockIsDatabaseConfigured: vi.fn(() => true),
    mockGetSocialPost: vi.fn(),
    MockSocialPostNotFoundError,
  };
});

vi.mock("@/lib/auth/server", () => ({
  auth: { api: { getSession: vi.fn() } },
}));

vi.mock("@/lib/db", () => ({
  isDatabaseConfigured: () => mockIsDatabaseConfigured(),
  getDb: vi.fn(),
}));

vi.mock("@/lib/api-tokens/auth", () => ({
  authorizePublicApiRequest: (...args: unknown[]) => mockAuthorize(...args),
}));

vi.mock("@/lib/social/repository", () => ({
  getSocialPost: (...args: unknown[]) => mockGetSocialPost(...args),
  SocialPostNotFoundError: MockSocialPostNotFoundError,
}));

import { GET } from "../route";

function authorized(workspaceId = "ws_1") {
  return {
    authorized: true,
    session: {
      user: { id: `apitoken:${workspaceId}`, name: null, email: null },
      workspace: { id: workspaceId, organizationId: null },
      role: "owner" as const,
      planTier: "free" as const,
      permissions: getPermissionsForRole("owner"),
    },
  };
}

function request(): NextRequest {
  return {
    headers: new Headers({ authorization: "Bearer nb_valid" }),
    nextUrl: new URL("http://localhost:3000/api/v1/social-posts/spost_1"),
  } as unknown as NextRequest;
}

function context(postId = "spost_1") {
  return { params: Promise.resolve({ postId }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockIsDatabaseConfigured.mockReturnValue(true);
});

describe("/api/v1/social-posts/[postId] GET", () => {
  it("returns 503 when the database is not configured", async () => {
    mockIsDatabaseConfigured.mockReturnValue(false);
    const response = await GET(request(), context());
    expect(response.status).toBe(503);
  });

  it("returns the post's dispatch state through the registry handler", async () => {
    mockAuthorize.mockResolvedValue(authorized("ws_1"));
    mockGetSocialPost.mockResolvedValue({
      id: "spost_1",
      socialAccountId: "sacct_x",
      status: "published",
      dispatchStatus: "dispatched",
      dispatchAttempts: 1,
      retryCount: 0,
      scheduledAt: new Date("2026-07-10T15:00:00.000Z"),
      publishedAt: new Date("2026-07-10T15:00:05.000Z"),
      nextDispatchAt: null,
      lastDispatchError: null,
      errorMessage: null,
      platformPostId: "tweet_1",
      platformPostUrl: "https://x.com/acme/status/1",
      createdAt: new Date("2026-07-10T14:00:00.000Z"),
      updatedAt: new Date("2026-07-10T15:00:05.000Z"),
    });

    const response = await GET(request(), context());
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.postId).toBe("spost_1");
    expect(data.releaseUrl).toBe("https://x.com/acme/status/1");
    expect(mockGetSocialPost).toHaveBeenCalledWith("ws_1", "spost_1");
    expect(mockAuthorize).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ permission: "social:view" }),
    );
  });

  it("maps a missing post to a structured 404", async () => {
    mockAuthorize.mockResolvedValue(authorized("ws_1"));
    mockGetSocialPost.mockRejectedValue(new MockSocialPostNotFoundError());

    const response = await GET(request(), context("spost_missing"));
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data.error.code).toBe("not_found");
  });

  it("passes through the auth layer's 401", async () => {
    mockAuthorize.mockResolvedValue({
      authorized: false,
      response: NextResponse.json(
        { success: false, error: "Invalid or revoked API token." },
        { status: 401 },
      ),
    });

    const response = await GET(request(), context());
    expect(response.status).toBe(401);
    expect(mockGetSocialPost).not.toHaveBeenCalled();
  });
});
