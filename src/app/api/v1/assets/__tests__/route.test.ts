import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

import { getPermissionsForRole } from "@/lib/studio/authz";

const { mockAuthorize, mockIsDatabaseConfigured, mockListWorkspaceAssets } =
  vi.hoisted(() => ({
    mockAuthorize: vi.fn(),
    mockIsDatabaseConfigured: vi.fn(() => true),
    mockListWorkspaceAssets: vi.fn(),
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
  listWorkspaceAssets: (...args: unknown[]) => mockListWorkspaceAssets(...args),
}));

vi.mock("@/lib/social/repository", () => ({
  listSocialAccounts: vi.fn(),
}));

import { GET } from "../route";

function createRequest(url: string, headers?: HeadersInit): NextRequest {
  return {
    headers: new Headers(headers),
    nextUrl: new URL(url),
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

const BASE = "http://localhost:3000/api/v1/assets";

beforeEach(() => {
  vi.clearAllMocks();
  mockIsDatabaseConfigured.mockReturnValue(true);
});

describe("/api/v1/assets GET", () => {
  it("returns 503 when the database is not configured", async () => {
    mockIsDatabaseConfigured.mockReturnValue(false);

    const response = await GET(
      createRequest(BASE, { authorization: "Bearer nb_valid" }),
    );

    expect(response.status).toBe(503);
  });

  it("lists assets and forwards type/limit filters from the query string", async () => {
    mockAuthorize.mockResolvedValue(authorized("ws_1"));
    mockListWorkspaceAssets.mockResolvedValue([
      {
        id: "asset_1",
        workspaceId: "ws_1",
        projectId: null,
        type: "image",
        mimeType: "image/png",
        sizeBytes: 1024,
        width: 256,
        height: 256,
        durationSeconds: null,
        createdAt: new Date("2026-02-01T00:00:00.000Z"),
      },
    ]);

    const response = await GET(
      createRequest(`${BASE}?type=image&limit=5`, {
        authorization: "Bearer nb_valid",
      }),
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.assets[0].id).toBe("asset_1");
    expect(mockListWorkspaceAssets).toHaveBeenCalledWith("ws_1", {
      type: "image",
      limit: 5,
    });
    expect(mockAuthorize).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ permission: "assets:read" }),
    );
  });

  it("returns a structured 400 for an invalid limit", async () => {
    mockAuthorize.mockResolvedValue(authorized("ws_1"));

    const response = await GET(
      createRequest(`${BASE}?limit=abc`, {
        authorization: "Bearer nb_valid",
      }),
    );
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error.code).toBe("invalid_input");
    expect(mockListWorkspaceAssets).not.toHaveBeenCalled();
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
      createRequest(BASE, { authorization: "Bearer nb_bogus" }),
    );

    expect(response.status).toBe(401);
    expect(mockListWorkspaceAssets).not.toHaveBeenCalled();
  });
});
