import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const mockAuthorizeStudioRequest = vi.fn();
const mockListDecisions = vi.fn();

vi.mock("@/lib/db", () => ({
  isDatabaseConfigured: () => true,
  getDb: vi.fn(),
}));
vi.mock("@/lib/agent-authorization", () => ({
  DrizzleAgentAuthorizationRepository: class {
    listDecisionsForActor(...args: unknown[]) {
      return mockListDecisions(...args);
    }
  },
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

import { GET } from "../authorization-decisions/route";

function authorize(role: "owner" | "admin" | "member" = "admin") {
  mockAuthorizeStudioRequest.mockResolvedValue({
    authorized: true,
    userId: "human-1",
    workspaceId: "workspace-1",
    role,
  });
}

describe("authorization decision audit route", () => {
  beforeEach(() => vi.clearAllMocks());

  it("denies members before reading decisions", async () => {
    authorize("member");
    const response = await GET(
      new NextRequest("http://localhost/api/agents/authorization-decisions"),
      undefined,
    );

    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mockListDecisions).not.toHaveBeenCalled();
  });

  it("binds a Principal filter to the actor Workspace and redacts resources", async () => {
    authorize();
    mockListDecisions.mockResolvedValue([
      {
        id: "decision-1",
        workspaceId: "workspace-1",
        principalId: "principal-foreign-looking",
        keyId: "key-1",
        capabilityName: "content.publish",
        capabilityVersion: 1,
        authorizationContractDigest: "sha256:secret-contract",
        outcome: "denied",
        reason: "resource_unavailable",
        operatorTraceRef: "trace-1",
        grantRevisionId: null,
        policyRevisionId: null,
        resources: [{ kind: "channel", id: "secret-channel" }],
        createdAt: new Date("2026-07-24T00:00:00.000Z"),
      },
    ]);
    const response = await GET(
      new NextRequest(
        "http://localhost/api/agents/authorization-decisions?principalId=principal-foreign-looking",
      ),
      undefined,
    );
    const body = await response.json();

    expect(mockListDecisions).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      actorUserId: "human-1",
      principalId: "principal-foreign-looking",
      limit: 100,
    });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(JSON.stringify(body)).not.toContain("secret-channel");
    expect(JSON.stringify(body)).not.toContain("secret-contract");
  });

  it("returns no-store for repository-level actor denial", async () => {
    authorize();
    mockListDecisions.mockResolvedValue(null);

    const response = await GET(
      new NextRequest("http://localhost/api/agents/authorization-decisions"),
      undefined,
    );

    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});
