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
}));

import { POST } from "./route";

function request(
  body: unknown,
  options: { workspaceId?: string; origin?: string } = {},
) {
  return new NextRequest(
    "http://localhost/api/studio/publishing-deliveries/capabilities",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-workspace-id": options.workspaceId ?? "workspace_1",
        origin: options.origin ?? "http://localhost",
      },
      body: JSON.stringify(body),
    },
  );
}

const input = {
  deliveryId: "delivery_1",
  channelIds: ["channel_linkedin"],
  artifactIds: ["artifact:text.v1", "artifact:image.v1"],
};

describe("Studio Publishing Delivery cancellation capability", () => {
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
      capability: { name: "publishing_deliveries.cancel", version: 1 },
      requestDigest: `sha256:${"a".repeat(64)}`,
      status: "completed",
      output: {
        schema: "publishing-delivery-cancellation/v1",
        cancellationId: "cancellation_1",
        deliveryId: "delivery_1",
        desiredState: "cancel",
        stateAtRequest: "scheduled",
        outcome: "prevented",
        externallyCompletedAtRequest: false,
        requestedAt: "2026-08-09T00:00:00.000Z",
        durable: true,
        externallyReversed: false,
      },
      warnings: [],
    });
  });

  it("dispatches intrinsic cancellation with server-owned Human identity", async () => {
    const response = await POST(request({
      capability: "publishing_deliveries.cancel@1",
      input,
    }), undefined);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      capability: "publishing_deliveries.cancel@1",
      result: { outcome: "prevented", externallyReversed: false },
    });
    expect(mockDispatch).toHaveBeenCalledWith(
      { capability: "publishing_deliveries.cancel@1", input },
      {
        securityContext: {
          kind: "human",
          workspaceId: "workspace_1",
          userId: "owner_1",
          role: "owner",
        },
      },
    );
    expect(mockDispatch.mock.calls[0]?.[1]?.securityContext).not.toHaveProperty(
      "idempotencyKey",
    );
  });

  it("does not treat Studio role as cancellation authority", async () => {
    mockAuthorize.mockResolvedValueOnce({
      authorized: true,
      workspaceId: "workspace_1",
      userId: "member_1",
      role: "member",
    });
    mockDispatch.mockResolvedValueOnce({
      type: "capability_error",
      capability: { name: "publishing_deliveries.cancel", version: 1 },
      requestDigest: `sha256:${"b".repeat(64)}`,
      code: "PUBLISHING_DELIVERY_CANCELLATION_NOT_AUTHORIZED",
      category: "authorization",
      message: "Exact current cancellation authority is required.",
      retryable: false,
      operatorTraceRef: "trace_1",
    });

    const response = await POST(request({
      capability: "publishing_deliveries.cancel@1",
      input,
    }), undefined);
    expect(response.status).toBe(403);
    expect(mockDispatch).toHaveBeenCalledTimes(1);
    await expect(response.json()).resolves.toMatchObject({
      code: "PUBLISHING_DELIVERY_CANCELLATION_NOT_AUTHORIZED",
    });
  });

  it("requires explicit Workspace selection and same-origin mutation", async () => {
    const workspace = await POST(request(
      { capability: "publishing_deliveries.cancel@1", input },
      { workspaceId: "workspace_other" },
    ), undefined);
    expect(workspace.status).toBe(400);
    expect(mockDispatch).not.toHaveBeenCalled();

    const crossOrigin = await POST(request(
      { capability: "publishing_deliveries.cancel@1", input },
      { origin: "https://attacker.example" },
    ), undefined);
    expect(crossOrigin.status).toBe(403);
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it("rejects unrelated capabilities and malformed exact resources", async () => {
    const unrelated = await POST(request({
      capability: "publishing_plan_revisions.release@1",
      input,
    }), undefined);
    expect(unrelated.status).toBe(400);

    const malformed = await POST(request({
      capability: "publishing_deliveries.cancel@1",
      input: { ...input, channelIds: [] },
    }), undefined);
    expect(malformed.status).toBe(400);
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it("maps not-found capability evidence without making it cacheable", async () => {
    mockDispatch.mockResolvedValueOnce({
      type: "capability_error",
      capability: { name: "publishing_deliveries.cancel", version: 1 },
      requestDigest: `sha256:${"c".repeat(64)}`,
      code: "PUBLISHING_DELIVERY_NOT_FOUND",
      category: "not_found",
      message: "The Publishing Delivery is unavailable.",
      retryable: false,
      operatorTraceRef: "trace_2",
    });
    const response = await POST(request({
      capability: "publishing_deliveries.cancel@1",
      input,
    }), undefined);
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toContain("no-store");
    await expect(response.json()).resolves.toMatchObject({
      code: "PUBLISHING_DELIVERY_NOT_FOUND",
      operatorTraceRef: "trace_2",
    });
  });
});
