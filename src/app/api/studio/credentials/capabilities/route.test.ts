import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const mockAuthorize = vi.fn();
const mockDispatch = vi.fn();

vi.mock("@/lib/db", () => ({
  isDatabaseConfigured: () => true,
}));
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
    getDefinition: () => ({ idempotency: { mode: "key-required" } }),
  },
}));

import { POST } from "./route";

function request(idempotencyKey?: string, workspaceId = "workspace-1") {
  return new NextRequest(
    "http://localhost/api/studio/credentials/capabilities",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-workspace-id": workspaceId,
        ...(idempotencyKey
          ? { "idempotency-key": idempotencyKey }
          : {}),
      },
      body: JSON.stringify({
        capability: "credentials.profiles.create@1",
        input: {
          name: "Production",
          provider: "openai",
          slotName: "primary",
          secret: "sk-private-value",
        },
      }),
    },
  );
}

describe("canonical human credential capability endpoint", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthorize.mockResolvedValue({
      authorized: true,
      userId: "human-1",
      workspaceId: "workspace-1",
      role: "owner",
    });
    mockDispatch.mockResolvedValue({
      type: "capability_result",
      capability: { name: "credentials.profiles.create", version: 1 },
      requestDigest: `sha256:${"a".repeat(64)}`,
      status: "completed",
      output: { id: "profile-1" },
      warnings: [],
    });
  });

  it("requires an idempotency key for protected human mutations", async () => {
    const response = await POST(request(), undefined);

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      success: false,
      code: "IDEMPOTENCY_KEY_REQUIRED",
    });
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it("propagates the validated transport key only in server-owned human context", async () => {
    const response = await POST(
      request("profile-create-submit-123"),
      undefined,
    );

    expect(response.status).toBe(200);
    expect(JSON.stringify(await response.clone().json())).not.toContain(
      "sk-private-value",
    );
    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        capability: "credentials.profiles.create@1",
      }),
      {
        securityContext: expect.objectContaining({
          kind: "human",
          workspaceId: "workspace-1",
          userId: "human-1",
          idempotencyKey: "profile-create-submit-123",
        }),
      },
    );
  });

  it("denies a cross-Workspace canonical request before dispatch", async () => {
    mockAuthorize.mockResolvedValue({
      authorized: false,
      status: 403,
      error: "Selected Workspace is unavailable.",
    });

    const response = await POST(
      request("profile-create-submit-123", "workspace-2"),
      undefined,
    );

    expect(response.status).toBe(403);
    expect(mockDispatch).not.toHaveBeenCalled();
  });
});
