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
        mode: name.endsWith("create") || name === "quota_waits.resume"
          ? "key-required"
          : "retry-safe",
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
  return new NextRequest("http://localhost/api/studio/quotas/capabilities", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-workspace-id": options.workspaceId ?? "workspace_1",
      ...(options.idempotencyKey
        ? { "idempotency-key": options.idempotencyKey }
        : {}),
    },
    body: JSON.stringify({ capability, input }),
  });
}

describe("Studio Quota capability facade", () => {
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
      capability: { name: "quota_waits.list", version: 1 },
      requestDigest: `sha256:${"a".repeat(64)}`,
      status: "completed",
      output: { schema: "quota-wait-list/v1", items: [] },
      warnings: [],
    });
  });

  it("dispatches reads with server-owned Workspace and human identity", async () => {
    const response = await POST(request("quota_waits.list@1"), undefined);
    expect(response.status).toBe(200);
    expect(mockDispatch).toHaveBeenCalledWith(
      { capability: "quota_waits.list@1", input: {} },
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

  it.each([
    "quota_policy_revisions.create@1",
    "quota_waits.resume@1",
  ])("requires a transport idempotency key for %s", async (capability) => {
    const response = await POST(request(capability), undefined);
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: "IDEMPOTENCY_KEY_REQUIRED",
    });
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it("passes a validated resume key only through server-owned context", async () => {
    const response = await POST(request(
      "quota_waits.resume@1",
      { waitId: "wait_1" },
      { idempotencyKey: "resume-wait-123" },
    ), undefined);
    expect(response.status).toBe(200);
    expect(mockDispatch).toHaveBeenCalledWith(
      { capability: "quota_waits.resume@1", input: { waitId: "wait_1" } },
      {
        securityContext: expect.objectContaining({
          workspaceId: "workspace_1",
          idempotencyKey: "resume-wait-123",
        }),
      },
    );
  });

  it("denies members and unrelated capability identities before dispatch", async () => {
    mockAuthorize.mockResolvedValueOnce({
      authorized: true,
      workspaceId: "workspace_1",
      userId: "member_1",
      role: "member",
    });
    expect((await POST(request("quota_waits.list@1"), undefined)).status).toBe(403);
    expect(mockDispatch).not.toHaveBeenCalled();

    mockAuthorize.mockResolvedValueOnce({
      authorized: true,
      workspaceId: "workspace_1",
      userId: "owner_1",
      role: "owner",
    });
    expect((await POST(request("workflow_runs.start@2"), undefined)).status).toBe(400);
    expect(mockDispatch).not.toHaveBeenCalled();
  });
});
