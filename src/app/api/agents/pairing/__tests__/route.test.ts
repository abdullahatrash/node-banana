import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const mockAuthorizeStudioRequest = vi.fn();
const mockInspectPairingConfirmation = vi.fn();
const mockApprovePairingConfirmation = vi.fn();

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
    inspectPairingConfirmation: (...args: unknown[]) =>
      mockInspectPairingConfirmation(...args),
    approvePairingConfirmation: (...args: unknown[]) =>
      mockApprovePairingConfirmation(...args),
  },
}));

import { GET, POST } from "../[challengeId]/route";

const context = {
  params: Promise.resolve({ challengeId: "nbpc_selector_secret" }),
};

function request(method = "GET") {
  return new NextRequest("http://localhost:3000/api/agents/pairing/challenge", {
    method,
    headers: {
      "x-workspace-id": "workspace-1",
      ...(method === "POST" ? { origin: "http://localhost:3000" } : {}),
    },
  });
}

describe("/api/agents/pairing/[challengeId]", () => {
  beforeEach(() => vi.clearAllMocks());

  it("requires an owner/admin role before inspecting requested access", async () => {
    mockAuthorizeStudioRequest.mockResolvedValue({
      authorized: true,
      userId: "member-1",
      workspaceId: "workspace-1",
      role: "member",
    });

    const response = await GET(request(), context);

    expect(response.status).toBe(403);
    expect(mockInspectPairingConfirmation).not.toHaveBeenCalled();
  });

  it("binds approval to the authenticated user and selected Workspace", async () => {
    mockAuthorizeStudioRequest.mockResolvedValue({
      authorized: true,
      userId: "admin-1",
      workspaceId: "workspace-1",
      role: "admin",
    });
    mockApprovePairingConfirmation.mockResolvedValue({
      approved: true,
      workspaceId: "workspace-1",
      agentName: "Publisher",
      requestedAccess: ["content.read"],
    });

    const response = await POST(request("POST"), context);

    expect(response.status).toBe(200);
    expect(mockApprovePairingConfirmation).toHaveBeenCalledWith({
      confirmationId: "nbpc_selector_secret",
      workspaceId: "workspace-1",
      sponsorUserId: "admin-1",
    });
    expect(JSON.stringify(await response.json())).not.toContain("admin-1");
  });

  it("rejects approval without an explicit Workspace selection", async () => {
    mockAuthorizeStudioRequest.mockResolvedValue({
      authorized: true,
      userId: "admin-1",
      workspaceId: "workspace-1",
      role: "admin",
    });
    const response = await POST(
      new NextRequest("http://localhost:3000/api/agents/pairing/challenge", {
        method: "POST",
        headers: { origin: "http://localhost:3000" },
      }),
      context,
    );

    expect(response.status).toBe(400);
    expect(mockApprovePairingConfirmation).not.toHaveBeenCalled();
  });
});
