import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const { mockIsDatabaseConfigured, mockWithApiPermission, mockRevokeApiToken } =
  vi.hoisted(() => ({
    mockIsDatabaseConfigured: vi.fn(() => true),
    mockWithApiPermission: vi.fn(),
    mockRevokeApiToken: vi.fn(),
  }));

vi.mock("@/lib/auth/server", () => ({
  auth: { api: { getSession: vi.fn() } },
}));

vi.mock("@/lib/db", () => ({
  isDatabaseConfigured: () => mockIsDatabaseConfigured(),
  getDb: vi.fn(),
}));

vi.mock("@/lib/studio/authz", async () => {
  const actual = await vi.importActual<typeof import("@/lib/studio/authz")>(
    "@/lib/studio/authz",
  );
  return {
    ...actual,
    withApiPermission: (...args: unknown[]) => mockWithApiPermission(...args),
  };
});

vi.mock("@/lib/api-tokens/repository", () => ({
  revokeApiToken: (...args: unknown[]) => mockRevokeApiToken(...args),
}));

import { DELETE } from "../[tokenId]/route";

function createRequest(): NextRequest {
  return {
    headers: new Headers(),
    nextUrl: new URL("http://localhost:3000/api/tokens/apitok_1"),
  } as unknown as NextRequest;
}

function paramsFor(tokenId: string) {
  return { params: Promise.resolve({ tokenId }) };
}

function authorizedAs(workspaceId: string) {
  mockWithApiPermission.mockResolvedValue({
    authorized: true,
    session: {
      user: { id: "user_1", name: null, email: null },
      workspace: { id: workspaceId, organizationId: null },
      role: "owner",
      planTier: "free",
      permissions: ["workspaces:read", "workspaces:write"],
    },
  });
}

describe("/api/tokens/[tokenId] DELETE (revoke)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsDatabaseConfigured.mockReturnValue(true);
  });

  it("revokes a token scoped to the caller's workspace", async () => {
    authorizedAs("ws_1");
    mockRevokeApiToken.mockResolvedValue(true);

    const response = await DELETE(createRequest(), paramsFor("apitok_1"));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(mockRevokeApiToken).toHaveBeenCalledWith({
      workspaceId: "ws_1",
      tokenId: "apitok_1",
    });
  });

  it("returns 404 when the token does not belong to the workspace", async () => {
    authorizedAs("ws_1");
    mockRevokeApiToken.mockResolvedValue(false);

    const response = await DELETE(
      createRequest(),
      paramsFor("apitok_other_tenant"),
    );
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data.success).toBe(false);
  });

  it("propagates the authz failure for non-writers", async () => {
    mockWithApiPermission.mockResolvedValue({
      authorized: false,
      response: NextResponse.json(
        { success: false, error: "forbidden" },
        { status: 403 },
      ),
    });

    const response = await DELETE(createRequest(), paramsFor("apitok_1"));

    expect(response.status).toBe(403);
    expect(mockRevokeApiToken).not.toHaveBeenCalled();
  });

  it("returns 503 when the database is not configured", async () => {
    mockIsDatabaseConfigured.mockReturnValue(false);

    const response = await DELETE(createRequest(), paramsFor("apitok_1"));

    expect(response.status).toBe(503);
  });
});
