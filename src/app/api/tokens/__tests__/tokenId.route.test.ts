import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const { mockIsDatabaseConfigured, mockAuthorizeStudioRequest, mockRevokeApiToken } =
  vi.hoisted(() => ({
    mockIsDatabaseConfigured: vi.fn(() => true),
    mockAuthorizeStudioRequest: vi.fn(),
    mockRevokeApiToken: vi.fn(),
  }));

vi.mock("@/lib/db", () => ({
  isDatabaseConfigured: () => mockIsDatabaseConfigured(),
}));

vi.mock("@/lib/studio/authz", () => ({
  authorizeStudioRequest: (...args: unknown[]) =>
    mockAuthorizeStudioRequest(...args),
  authzErrorResponse: (result: { status: number; error: string }) =>
    NextResponse.json(
      { success: false, error: result.error },
      { status: result.status },
    ),
}));

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
  mockAuthorizeStudioRequest.mockResolvedValue({
    authorized: true,
    userId: "user_1",
    workspaceId,
    role: "owner",
    permissions: ["workspaces:read", "workspaces:write", "workspaces:delete"],
    contentSession: {},
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
    mockAuthorizeStudioRequest.mockResolvedValue({
      authorized: false,
      status: 403,
      error: "forbidden",
      reason: "forbidden",
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
