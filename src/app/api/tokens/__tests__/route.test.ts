import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const {
  mockIsDatabaseConfigured,
  mockAuthorizeStudioRequest,
  mockCreateApiToken,
  mockListApiTokens,
} = vi.hoisted(() => ({
  mockIsDatabaseConfigured: vi.fn(() => true),
  mockAuthorizeStudioRequest: vi.fn(),
  mockCreateApiToken: vi.fn(),
  mockListApiTokens: vi.fn(),
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
  createApiToken: (...args: unknown[]) => mockCreateApiToken(...args),
  listApiTokens: (...args: unknown[]) => mockListApiTokens(...args),
}));

import { GET, POST } from "../route";

function createRequest(body?: unknown): NextRequest {
  return {
    headers: new Headers(),
    nextUrl: new URL("http://localhost:3000/api/tokens"),
    json: async () => body,
  } as unknown as NextRequest;
}

function authorizedAs(workspaceId: string, userId = "user_1") {
  mockAuthorizeStudioRequest.mockResolvedValue({
    authorized: true,
    userId,
    workspaceId,
    role: "owner",
    permissions: ["workspaces:read", "workspaces:write"],
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

describe("/api/tokens", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsDatabaseConfigured.mockReturnValue(true);
  });

  describe("POST (create)", () => {
    it("creates a token and returns the raw secret exactly once", async () => {
      authorizedAs("ws_1");
      mockCreateApiToken.mockResolvedValue({
        id: "apitok_1",
        name: "CI pipeline",
        token: "nb_rawsecretshownonce",
        prefix: "nb_rawsecre",
        createdAt: new Date("2026-07-10T00:00:00.000Z"),
      });

      const response = await POST(createRequest({ name: "CI pipeline" }));
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.success).toBe(true);
      expect(data.token).toEqual(
        expect.objectContaining({
          id: "apitok_1",
          name: "CI pipeline",
          token: "nb_rawsecretshownonce",
          prefix: "nb_rawsecre",
        }),
      );
      expect(mockCreateApiToken).toHaveBeenCalledWith({
        workspaceId: "ws_1",
        name: "CI pipeline",
        createdByUserId: "user_1",
      });
    });

    it("rejects a missing or blank name with 400", async () => {
      authorizedAs("ws_1");

      const response = await POST(createRequest({ name: "   " }));
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(mockCreateApiToken).not.toHaveBeenCalled();
    });

    it("propagates the authz failure for non-writers", async () => {
      unauthorized(403, "You do not have access to this workspace.");

      const response = await POST(createRequest({ name: "CI" }));

      expect(response.status).toBe(403);
      expect(mockCreateApiToken).not.toHaveBeenCalled();
    });

    it("returns 503 when the database is not configured", async () => {
      mockIsDatabaseConfigured.mockReturnValue(false);

      const response = await POST(createRequest({ name: "CI" }));

      expect(response.status).toBe(503);
    });
  });

  describe("GET (list)", () => {
    it("lists the workspace's tokens without exposing hashes", async () => {
      authorizedAs("ws_1");
      mockListApiTokens.mockResolvedValue([
        {
          id: "apitok_1",
          name: "CI pipeline",
          prefix: "nb_rawsecre",
          revoked: false,
          lastUsedAt: null,
          createdAt: new Date("2026-07-10T00:00:00.000Z"),
        },
      ]);

      const response = await GET(createRequest());
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.tokens).toHaveLength(1);
      expect(data.tokens[0]).toEqual(
        expect.objectContaining({
          id: "apitok_1",
          name: "CI pipeline",
          prefix: "nb_rawsecre",
          revoked: false,
          lastUsedAt: null,
        }),
      );
      expect(JSON.stringify(data)).not.toContain("tokenHash");
      expect(mockListApiTokens).toHaveBeenCalledWith("ws_1");
    });

    it("propagates the authz failure when unauthenticated", async () => {
      unauthorized(401, "Please sign in.");

      const response = await GET(createRequest());

      expect(response.status).toBe(401);
      expect(mockListApiTokens).not.toHaveBeenCalled();
    });
  });
});
