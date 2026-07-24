import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const mockAuthorizeStudioRequest = vi.fn();
const mockListPrincipals = vi.fn();

vi.mock("@/lib/db", () => ({
  isDatabaseConfigured: () => true,
  getDb: vi.fn(),
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

vi.mock("@/lib/agent-auth", () => ({
  AGENT_AUTH_SERVICE: {
    listPrincipals: (...args: unknown[]) => mockListPrincipals(...args),
  },
}));

import { GET } from "../route";

function request() {
  return new NextRequest("http://localhost:3000/api/agents", {
    headers: { "x-workspace-id": "workspace-1" },
  });
}

describe("/api/agents", () => {
  beforeEach(() => vi.clearAllMocks());

  it("explicitly denies member management", async () => {
    mockAuthorizeStudioRequest.mockResolvedValue({
      authorized: true,
      userId: "member-1",
      workspaceId: "workspace-1",
      role: "member",
    });

    const response = await GET(request());

    expect(response.status).toBe(403);
    expect(mockListPrincipals).not.toHaveBeenCalled();
  });

  it("lists safe Principal and key metadata for owners", async () => {
    mockAuthorizeStudioRequest.mockResolvedValue({
      authorized: true,
      userId: "owner-1",
      workspaceId: "workspace-1",
      role: "owner",
    });
    mockListPrincipals.mockResolvedValue([
      {
        id: "principal-1",
        workspaceId: "workspace-1",
        sponsorUserId: "owner-1",
        name: "Publisher",
        requestedAccess: ["content.read"],
        status: "active",
        suspendedAt: null,
        revokedAt: null,
        createdAt: new Date("2026-07-24T00:00:00.000Z"),
        updatedAt: new Date("2026-07-24T00:00:00.000Z"),
        keys: [
          {
            id: "key-1",
            principalId: "principal-1",
            name: "Laptop",
            lookupPrefix: "selector1234",
            pepperVersion: 1,
            expiresAt: null,
            revokedAt: null,
            lastUsedAt: null,
            createdAt: new Date("2026-07-24T00:00:00.000Z"),
          },
        ],
      },
    ]);

    const response = await GET(request());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mockListPrincipals).toHaveBeenCalledWith("workspace-1", "owner-1");
    expect(body.principals[0]).toMatchObject({
      id: "principal-1",
      workspaceId: "workspace-1",
      keys: [{ lookupPrefix: "selector1234" }],
    });
    expect(JSON.stringify(body)).not.toContain("sponsorUserId");
    expect(JSON.stringify(body)).not.toContain("secretHash");
    expect(JSON.stringify(body)).not.toContain("pepperVersion");
  });
});
