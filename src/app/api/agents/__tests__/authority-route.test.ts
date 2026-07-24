import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { authorizationContractDigestFor } from "@/lib/agent-tools";
import { PRODUCTION_CAPABILITY_REGISTRY as CAPABILITY_REGISTRY } from "@/lib/agent-runtime/server-dispatcher";

const mockAuthorizeStudioRequest = vi.fn();
const mockProvisionAuthority = vi.fn();

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

vi.mock("@/lib/agent-auth", () => {
  class AgentValidationError extends Error {}
  return {
    AgentValidationError,
    AGENT_AUTH_SERVICE: {
      provisionAuthority: (...args: unknown[]) =>
        mockProvisionAuthority(...args),
    },
  };
});

import { POST } from "../[principalId]/authority/route";

const context = {
  params: Promise.resolve({ principalId: "principal-1" }),
};
const emptyResources = {
  channelIds: [],
  credentialProfileIds: [],
  workflowIds: [],
  automationIds: [],
};

function authorize(role: "owner" | "admin" | "member" = "admin") {
  mockAuthorizeStudioRequest.mockResolvedValue({
    authorized: true,
    userId: "human-1",
    workspaceId: "workspace-1",
    role,
  });
}

function request(capability = "capabilities.list@1") {
  return new NextRequest(
    "http://localhost:3000/api/agents/principal-1/authority",
    {
      method: "POST",
      headers: {
        origin: "http://localhost:3000",
        "x-workspace-id": "workspace-1",
        "x-request-id": "request-1",
      },
      body: JSON.stringify({
        expectedPolicyRevision: 0,
        grantSetName: "Primary",
        grants: [{ capability, resources: emptyResources }],
        policyGrants: [{ capability, resources: emptyResources }],
        key: {
          name: "Provisioned",
          authorizationScopes: [{ capability, resources: emptyResources }],
        },
      }),
    },
  );
}

describe("Agent authority provisioning route", () => {
  beforeEach(() => vi.clearAllMocks());

  it("derives registry contracts server-side and returns the plaintext once with no-store", async () => {
    authorize();
    mockProvisionAuthority.mockResolvedValue({
      agentKey: "nbak_once_only",
      key: {
        id: "key-1",
        principalId: "principal-1",
        name: "Provisioned",
        lookupPrefix: "prefix",
        authorizationScopes: [],
        expiresAt: null,
        revokedAt: null,
        lastUsedAt: null,
        createdAt: new Date("2026-07-24T00:00:00.000Z"),
      },
      grantSetId: "set-1",
      grantRevisionId: "grant-revision-1",
      grantRevision: 1,
      policyRevisionId: "policy-revision-1",
      policyRevision: 1,
    });

    const response = await POST(request(), context);
    const body = await response.json();
    const registration = CAPABILITY_REGISTRY.getRegistration({
      name: "capabilities.list",
      version: 1,
    })!;
    const digest = authorizationContractDigestFor(
      { name: "capabilities.list", version: 1 },
      registration.authorization,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mockProvisionAuthority).toHaveBeenCalledWith(
      expect.objectContaining({
        grants: [
          expect.objectContaining({ authorizationContractDigest: digest }),
        ],
        policyGrants: [
          expect.objectContaining({ authorizationContractDigest: digest }),
        ],
      }),
    );
    expect(body.agentKey).toBe("nbak_once_only");
    expect(JSON.stringify(body)).not.toContain("secretHash");
  });

  it("rejects unpublished identities before the atomic repository call", async () => {
    authorize();
    const response = await POST(request("missing.capability@1"), context);

    expect(response.status).toBe(400);
    expect(mockProvisionAuthority).not.toHaveBeenCalled();
  });

  it("surfaces an atomic provisioning failure without a partial fallback", async () => {
    authorize();
    mockProvisionAuthority.mockRejectedValue(new Error("transaction rolled back"));

    const response = await POST(request(), context);

    expect(response.status).toBe(500);
    expect(mockProvisionAuthority).toHaveBeenCalledTimes(1);
  });
});
