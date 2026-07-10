import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const { mockIsDatabaseConfigured, mockAuthorizeStudioRequest, mockDeleteProviderKey } =
  vi.hoisted(() => ({
    mockIsDatabaseConfigured: vi.fn(() => true),
    mockAuthorizeStudioRequest: vi.fn(),
    mockDeleteProviderKey: vi.fn(),
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

vi.mock("@/lib/byok/repository", () => ({
  deleteProviderKey: (...args: unknown[]) => mockDeleteProviderKey(...args),
}));

import { DELETE } from "../route";

function createRequest(): NextRequest {
  return {
    headers: new Headers(),
    nextUrl: new URL("http://localhost:3000/api/keys/openai"),
  } as unknown as NextRequest;
}

function context(provider: string) {
  return { params: Promise.resolve({ provider }) };
}

function authorizedAs(workspaceId: string, userId = "user_1") {
  mockAuthorizeStudioRequest.mockResolvedValue({
    authorized: true,
    userId,
    workspaceId,
    role: "owner",
    permissions: ["workspaces:read", "workspaces:write", "workspaces:delete"],
    contentSession: {},
  });
}

function unauthorized(status: 401 | 403, error: string) {
  mockAuthorizeStudioRequest.mockResolvedValue({
    authorized: false,
    status,
    error,
    reason: status === 401 ? "unauthenticated" : "forbidden",
  });
}

describe("/api/keys/[provider]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsDatabaseConfigured.mockReturnValue(true);
  });

  describe("DELETE", () => {
    it("deletes the workspace's stored key for the provider", async () => {
      authorizedAs("ws_1");
      mockDeleteProviderKey.mockResolvedValue(true);

      const response = await DELETE(createRequest(), context("openai"));
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(mockDeleteProviderKey).toHaveBeenCalledWith({
        workspaceId: "ws_1",
        provider: "openai",
      });
    });

    it("returns 404 when there is no stored key for the provider", async () => {
      authorizedAs("ws_1");
      mockDeleteProviderKey.mockResolvedValue(false);

      const response = await DELETE(createRequest(), context("anthropic"));
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.success).toBe(false);
    });

    it("rejects an unknown provider with 400", async () => {
      authorizedAs("ws_1");

      const response = await DELETE(createRequest(), context("not-a-provider"));
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(mockDeleteProviderKey).not.toHaveBeenCalled();
    });

    it("propagates the authz failure for non-owners/admins", async () => {
      unauthorized(403, "You do not have access to this workspace.");

      const response = await DELETE(createRequest(), context("openai"));

      expect(response.status).toBe(403);
      expect(mockDeleteProviderKey).not.toHaveBeenCalled();
    });
  });
});
