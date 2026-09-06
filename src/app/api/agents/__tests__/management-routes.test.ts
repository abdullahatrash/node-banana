import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const mockAuthorizeStudioRequest = vi.fn();
const mockRotateKey = vi.fn();
const mockRevokeKey = vi.fn();
const mockSetPrincipalStatus = vi.fn();

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
    rotateKey: (...args: unknown[]) => mockRotateKey(...args),
    revokeKey: (...args: unknown[]) => mockRevokeKey(...args),
    setPrincipalStatus: (...args: unknown[]) =>
      mockSetPrincipalStatus(...args),
  },
}));
vi.mock("@/lib/governance/step-up-http", () => ({ requireGovernanceStepUp: vi.fn(async () => null) }));

import { POST as rotateKey } from "../[principalId]/keys/route";
import { PATCH as setPrincipalStatus } from "../[principalId]/route";
import { DELETE as revokeKey } from "../keys/[keyId]/route";

const principalContext = {
  params: Promise.resolve({ principalId: "principal-1" }),
};
const keyContext = { params: Promise.resolve({ keyId: "key-1" }) };

function authorized(role: "owner" | "admin" | "member" = "admin") {
  mockAuthorizeStudioRequest.mockResolvedValue({
    authorized: true,
    userId: "human-1",
    workspaceId: "workspace-1",
    role,
  });
}

describe("Agent management routes", () => {
  beforeEach(() => vi.clearAllMocks());

  it("binds rotation to the authenticated actor and selected Workspace", async () => {
    authorized();
    mockRotateKey.mockResolvedValue({
      agentKey: "nbak_selector_secret",
      key: {
        id: "key-2",
        principalId: "principal-1",
        name: "Replacement",
        lookupPrefix: "selector",
        expiresAt: null,
        revokedAt: null,
        lastUsedAt: null,
        createdAt: new Date("2026-07-24T00:00:00.000Z"),
      },
    });
    const request = new NextRequest(
      "http://localhost:3000/api/agents/principal-1/keys",
      {
        method: "POST",
        headers: {
          "x-workspace-id": "workspace-1",
          origin: "http://localhost:3000",
        },
        body: JSON.stringify({ name: "Replacement" }),
      },
    );

    const response = await rotateKey(request, principalContext);

    expect(response.status).toBe(200);
    expect(mockRotateKey).toHaveBeenCalledWith({
      principalId: "principal-1",
      workspaceId: "workspace-1",
      actorUserId: "human-1",
      name: "Replacement",
      expiresAt: undefined,
      authorizationScopes: [],
    });
    expect((await response.json()).agentKey).toBe("nbak_selector_secret");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("binds Principal and key revocation to the selected Workspace", async () => {
    authorized("owner");
    mockSetPrincipalStatus.mockResolvedValue({
      id: "principal-1",
      workspaceId: "workspace-1",
      name: "Publisher",
      requestedAccess: ["content.read"],
      status: "revoked",
      suspendedAt: null,
      revokedAt: new Date("2026-07-24T00:00:00.000Z"),
    });
    const statusResponse = await setPrincipalStatus(
      new NextRequest("http://localhost:3000/api/agents/principal-1", {
        method: "PATCH",
        headers: {
          "x-workspace-id": "workspace-1",
          origin: "http://localhost:3000",
        },
        body: JSON.stringify({ status: "revoked" }),
      }),
      principalContext,
    );
    const revokeResponse = await revokeKey(
      new NextRequest("http://localhost:3000/api/agents/keys/key-1", {
        method: "DELETE",
        headers: {
          "x-workspace-id": "workspace-1",
          origin: "http://localhost:3000",
        },
      }),
      keyContext,
    );

    expect(statusResponse.status).toBe(200);
    expect(revokeResponse.status).toBe(200);
    expect(mockSetPrincipalStatus).toHaveBeenCalledWith({
      principalId: "principal-1",
      workspaceId: "workspace-1",
      actorUserId: "human-1",
      status: "revoked",
    });
    expect(mockRevokeKey).toHaveBeenCalledWith({
      keyId: "key-1",
      workspaceId: "workspace-1",
      actorUserId: "human-1",
    });
  });

  it("denies member lifecycle management before calling the service", async () => {
    authorized("member");
    const response = await revokeKey(
      new NextRequest("http://localhost:3000/api/agents/keys/key-1", {
        method: "DELETE",
        headers: {
          "x-workspace-id": "workspace-1",
          origin: "http://localhost:3000",
        },
      }),
      keyContext,
    );

    expect(response.status).toBe(403);
    expect(mockRevokeKey).not.toHaveBeenCalled();
  });

  it("rejects cross-origin mutations", async () => {
    authorized();
    const response = await revokeKey(
      new NextRequest("http://localhost:3000/api/agents/keys/key-1", {
        method: "DELETE",
        headers: {
          "x-workspace-id": "workspace-1",
          origin: "https://attacker.example",
        },
      }),
      keyContext,
    );

    expect(response.status).toBe(403);
    expect(mockRevokeKey).not.toHaveBeenCalled();
  });
});
