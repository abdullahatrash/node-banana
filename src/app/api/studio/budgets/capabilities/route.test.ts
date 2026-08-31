import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const mockAuthorize = vi.fn();
const mockDispatch = vi.fn();

vi.mock("@/lib/db", () => ({ isDatabaseConfigured: () => true }));
vi.mock("@/lib/studio/authz", () => ({
  authorizeStudioRequest: (...args: unknown[]) => mockAuthorize(...args),
  authzErrorResponse: (result: { status: number; error: string }) =>
    NextResponse.json(
      { success: false, error: result.error },
      { status: result.status },
    ),
}));
vi.mock("@/lib/agent-runtime/server-dispatcher", () => ({
  dispatchCapability: (...args: unknown[]) => mockDispatch(...args),
  PRODUCTION_CAPABILITY_REGISTRY: {
    getDefinition: ({ name }: { name: string }) => ({
      idempotency: {
        mode: name.endsWith("create") ? "key-required" : "intrinsic",
      },
    }),
  },
}));

import { POST } from "./route";

function request(
  capability: string,
  input: Record<string, unknown> = {},
  options: { idempotencyKey?: string; workspaceId?: string } = {},
) {
  return new NextRequest(
    "http://localhost/api/studio/budgets/capabilities",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-workspace-id": options.workspaceId ?? "workspace_1",
        ...(options.idempotencyKey
          ? { "idempotency-key": options.idempotencyKey }
          : {}),
      },
      body: JSON.stringify({ capability, input }),
    },
  );
}

describe("Studio Budget capability façade", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthorize.mockResolvedValue({
      authorized: true,
      workspaceId: "workspace_1",
      userId: "owner_1",
      role: "owner",
    });
    mockDispatch.mockResolvedValue({
      type: "capability_result",
      capability: { name: "budget_policies.list", version: 1 },
      requestDigest: `sha256:${"a".repeat(64)}`,
      status: "completed",
      output: { schema: "budget-policy-list/v1", items: [] },
      warnings: [],
    });
  });

  it("dispatches a management read with server-owned human identity", async () => {
    const response = await POST(request("budget_policies.list@1"), undefined);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      capability: "budget_policies.list@1",
    });
    expect(mockDispatch).toHaveBeenCalledWith(
      { capability: "budget_policies.list@1", input: {} },
      {
        securityContext: expect.objectContaining({
          kind: "human",
          workspaceId: "workspace_1",
          userId: "owner_1",
          role: "owner",
        }),
      },
    );
  });

  it("requires a transport idempotency key for revision creation", async () => {
    const response = await POST(
      request("budget_policy_revisions.create@1"),
      undefined,
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: "IDEMPOTENCY_KEY_REQUIRED",
    });
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it("passes a validated key only through the server-owned context", async () => {
    const response = await POST(
      request(
        "pricing_overrides.create@1",
        { provider: "replicate" },
        { idempotencyKey: "pricing-submit-123" },
      ),
      undefined,
    );
    expect(response.status).toBe(200);
    expect(mockDispatch).toHaveBeenCalledWith(
      {
        capability: "pricing_overrides.create@1",
        input: { provider: "replicate" },
      },
      {
        securityContext: expect.objectContaining({
          workspaceId: "workspace_1",
          idempotencyKey: "pricing-submit-123",
        }),
      },
    );
  });

  it("denies members and non-Budget capability identities before dispatch", async () => {
    mockAuthorize.mockResolvedValueOnce({
      authorized: true,
      workspaceId: "workspace_1",
      userId: "member_1",
      role: "member",
    });
    const member = await POST(request("budget_policies.list@1"), undefined);
    expect(member.status).toBe(403);
    expect(mockDispatch).not.toHaveBeenCalled();

    mockAuthorize.mockResolvedValueOnce({
      authorized: true,
      workspaceId: "workspace_1",
      userId: "owner_1",
      role: "owner",
    });
    const unrelated = await POST(
      request("credentials.profiles.list@1"),
      undefined,
    );
    expect(unrelated.status).toBe(400);
    expect(mockDispatch).not.toHaveBeenCalled();
  });
});
