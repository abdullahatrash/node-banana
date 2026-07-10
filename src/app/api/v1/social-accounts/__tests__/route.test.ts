import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

import { getPermissionsForRole } from "@/lib/studio/authz";

const { mockAuthorize, mockIsDatabaseConfigured, mockListSocialAccounts } =
  vi.hoisted(() => ({
    mockAuthorize: vi.fn(),
    mockIsDatabaseConfigured: vi.fn(() => true),
    mockListSocialAccounts: vi.fn(),
  }));

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

vi.mock("@/lib/studio/repository", () => ({
  getWorkspaceById: vi.fn(),
  listWorkspaceAssets: vi.fn(),
}));

vi.mock("@/lib/social/repository", () => ({
  listSocialAccounts: (...args: unknown[]) => mockListSocialAccounts(...args),
}));

import { GET } from "../route";

function createRequest(headers?: HeadersInit): NextRequest {
  return {
    headers: new Headers(headers),
    nextUrl: new URL("http://localhost:3000/api/v1/social-accounts"),
  } as unknown as NextRequest;
}

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

beforeEach(() => {
  vi.clearAllMocks();
  mockIsDatabaseConfigured.mockReturnValue(true);
});

describe("/api/v1/social-accounts GET", () => {
  it("returns 503 when the database is not configured", async () => {
    mockIsDatabaseConfigured.mockReturnValue(false);

    const response = await GET(
      createRequest({ authorization: "Bearer nb_valid" }),
    );

    expect(response.status).toBe(503);
  });

  it("returns the workspace's accounts through the registry handler", async () => {
    mockAuthorize.mockResolvedValue(authorized("ws_1"));
    mockListSocialAccounts.mockResolvedValue([
      {
        id: "sacct_1",
        workspaceId: "ws_1",
        platform: "x",
        platformUserId: "12345",
        displayName: "Acme on X",
        username: "acme",
        avatarUrl: null,
        accessTokenEncrypted: "SECRET",
        refreshTokenEncrypted: null,
        accessTokenSecret: null,
        tokenExpiresAt: null,
        requiresReauth: false,
        disabled: false,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
      },
    ]);

    const response = await GET(
      createRequest({ authorization: "Bearer nb_valid" }),
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.accounts).toHaveLength(1);
    expect(data.accounts[0].id).toBe("sacct_1");
    expect(mockListSocialAccounts).toHaveBeenCalledWith("ws_1");
    expect(JSON.stringify(data)).not.toContain("SECRET");
    expect(mockAuthorize).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ permission: "social:view" }),
    );
  });

  it("passes through the auth layer's 401 for an invalid token", async () => {
    mockAuthorize.mockResolvedValue({
      authorized: false,
      response: NextResponse.json(
        { success: false, error: "Invalid or revoked API token." },
        { status: 401 },
      ),
    });

    const response = await GET(
      createRequest({ authorization: "Bearer nb_bogus" }),
    );

    expect(response.status).toBe(401);
    expect(mockListSocialAccounts).not.toHaveBeenCalled();
  });

  it("returns a structured 500 when the repository throws", async () => {
    mockAuthorize.mockResolvedValue(authorized("ws_1"));
    mockListSocialAccounts.mockRejectedValue(new Error("db down"));

    const response = await GET(
      createRequest({ authorization: "Bearer nb_valid" }),
    );
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data.success).toBe(false);
    expect(data.error.code).toBe("internal");
    expect(data.error.fix).toBeTruthy();
  });
});
