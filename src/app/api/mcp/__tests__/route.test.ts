import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

import { getPermissionsForRole } from "@/lib/studio/authz";

const { mockAuthorize, mockIsDatabaseConfigured, mockGetWorkspaceById } =
  vi.hoisted(() => ({
    mockAuthorize: vi.fn(),
    mockIsDatabaseConfigured: vi.fn(() => true),
    mockGetWorkspaceById: vi.fn(),
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
  getWorkspaceById: (...args: unknown[]) => mockGetWorkspaceById(...args),
  listWorkspaceAssets: vi.fn(async () => []),
}));

vi.mock("@/lib/social/repository", () => ({
  listSocialAccounts: vi.fn(async () => []),
}));

import { POST } from "../route";

function ownerSession(workspaceId = "ws_1") {
  return {
    user: { id: `apitoken:${workspaceId}`, name: null, email: null },
    workspace: { id: workspaceId, organizationId: null },
    role: "owner" as const,
    planTier: "free" as const,
    permissions: getPermissionsForRole("owner"),
  };
}

function mcpRequest(body: unknown, headers?: Record<string, string>): Request {
  return new Request("http://localhost:3000/api/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

const initializeBody = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "test", version: "1.0.0" },
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  mockIsDatabaseConfigured.mockReturnValue(true);
});

describe("/api/mcp POST", () => {
  it("returns 401 for an unauthenticated request", async () => {
    mockAuthorize.mockResolvedValue({
      authorized: false,
      response: NextResponse.json(
        { success: false, error: "Invalid or revoked API token." },
        { status: 401 },
      ),
    });

    const response = await POST(
      mcpRequest(initializeBody, { authorization: "Bearer nb_bogus" }),
    );

    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toMatch(/Bearer/i);
  });

  it("returns 503 when the database is not configured", async () => {
    mockIsDatabaseConfigured.mockReturnValue(false);

    const response = await POST(
      mcpRequest(initializeBody, { authorization: "Bearer nb_valid" }),
    );

    expect(response.status).toBe(503);
  });

  it("initializes an MCP session for a valid token", async () => {
    mockAuthorize.mockResolvedValue({
      authorized: true,
      session: ownerSession("ws_1"),
    });

    const response = await POST(
      mcpRequest(initializeBody, { authorization: "Bearer nb_valid" }),
    );

    expect(response.status).toBe(200);
    const text = await response.text();
    // Response may be JSON or an SSE frame; the initialize result carries the
    // server identity either way.
    expect(text).toContain("node-banana");
    expect(mockAuthorize).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ permission: "workspaces:read" }),
    );
  });
});
