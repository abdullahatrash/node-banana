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
  options: { workspaceId?: string; origin?: string; idempotencyKey?: string } = {},
) {
  return new NextRequest(
    "http://localhost/api/studio/publishing-deliveries/capabilities",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-workspace-id": options.workspaceId ?? "workspace_1",
        origin: options.origin ?? "http://localhost",
        ...(options.idempotencyKey
          ? { "idempotency-key": options.idempotencyKey }
          : {}),
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

describe("Studio Publishing Delivery command capabilities", () => {
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

  it.each([
    {
      capability: "publishing_deliveries.retry@1" as const,
      input: {
        ...input,
        approvalRequestId: "approval_retry_1",
        expectedFailureEvidenceDigest: `sha256:${"d".repeat(64)}`,
        idempotencyKey: "retry-delivery-1",
      },
      name: "publishing_deliveries.retry",
      output: {
        schema: "publishing-delivery-retry/v1",
        retryId: "retry_1",
        sourceDeliveryId: "delivery_1",
        sourceEvidenceDigest: `sha256:${"d".repeat(64)}`,
        delivery: {
          id: "delivery_retry_1",
          targetId: "target_1",
          channelId: "channel_1",
          publishAt: "2026-08-09T00:00:00.000Z",
          state: "scheduled",
          effectKey: "publishing-effect:v1:workspace_1:delivery_retry_1",
          acceptedAt: "2026-08-09T00:00:00.000Z",
          scheduledAt: "2026-08-09T00:00:00.000Z",
          externallyCompleted: false,
        },
        requestedAt: "2026-08-09T00:00:00.000Z",
        durable: true,
        externallyCompleted: false,
      },
    },
    {
      capability: "publishing_deliveries.reconcile@1" as const,
      input: {
        ...input,
        expectedUnknownEvidenceDigest: `sha256:${"e".repeat(64)}`,
      },
      name: "publishing_deliveries.reconcile",
      output: {
        schema: "publishing-delivery-reconciliation/v1",
        reconciliationId: "reconciliation_1",
        deliveryId: "delivery_1",
        sourceEvidenceDigest: `sha256:${"e".repeat(64)}`,
        effectKey: "publishing-effect:v1:workspace_1:delivery_1",
        effectGeneration: 1,
        status: "queued",
        resolution: null,
        requestedAt: "2026-08-09T00:00:00.000Z",
        completedAt: null,
        durable: true,
        externallyCompleted: null,
      },
    },
  ])("dispatches shared Human $capability through the closed route", async (value) => {
    mockDispatch.mockResolvedValueOnce({
      type: "capability_result",
      capability: { name: value.name, version: 1 },
      requestDigest: `sha256:${"f".repeat(64)}`,
      status: "accepted",
      output: value.output,
      warnings: [],
    });
    const response = await POST(request({
      capability: value.capability,
      input: value.input,
    }), undefined);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      capability: value.capability,
      result: value.output,
    });
    expect(mockDispatch).toHaveBeenCalledWith(
      { capability: value.capability, input: value.input },
      {
        securityContext: {
          kind: "human",
          workspaceId: "workspace_1",
          userId: "owner_1",
          role: "owner",
        },
      },
    );
  });

  it("surfaces recovery authority denial for a Studio member without role escalation", async () => {
    mockAuthorize.mockResolvedValueOnce({
      authorized: true,
      workspaceId: "workspace_1",
      userId: "member_1",
      role: "member",
    });
    mockDispatch.mockResolvedValueOnce({
      type: "capability_error",
      capability: { name: "publishing_deliveries.reconcile", version: 1 },
      requestDigest: `sha256:${"b".repeat(64)}`,
      code: "PUBLISHING_DELIVERY_RECOVERY_NOT_AUTHORIZED",
      category: "authorization",
      message: "Exact current recovery authority is required.",
      retryable: false,
      operatorTraceRef: "trace_recovery_1",
    });
    const recoveryInput = {
      ...input,
      expectedUnknownEvidenceDigest: `sha256:${"e".repeat(64)}`,
    };
    const response = await POST(request({
      capability: "publishing_deliveries.reconcile@1",
      input: recoveryInput,
    }), undefined);
    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toContain("no-store");
    await expect(response.json()).resolves.toMatchObject({
      code: "PUBLISHING_DELIVERY_RECOVERY_NOT_AUTHORIZED",
      operatorTraceRef: "trace_recovery_1",
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

  it("admits read capabilities for members without mutation origin checks", async () => {
    mockAuthorize.mockResolvedValueOnce({
      authorized: true,
      workspaceId: "workspace_1",
      userId: "member_1",
      role: "member",
    });
    mockDispatch.mockResolvedValueOnce({
      type: "capability_result",
      capability: { name: "publishing_deliveries.get", version: 2 },
      requestDigest: `sha256:${"a".repeat(64)}`,
      status: "completed",
      output: {
        schema: "publishing-delivery-inspection/v2",
        delivery: { id: "delivery_1" },
        cancellation: null,
      },
      warnings: [],
    });
    const response = await POST(request({
      capability: "publishing_deliveries.get@2",
      input: { deliveryId: "delivery_1" },
    }, { origin: "https://read-only.example" }), undefined);
    expect(response.status).toBe(200);
    expect(mockAuthorize).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: "read" }),
    );
    expect(mockDispatch).toHaveBeenCalledWith(
      {
        capability: "publishing_deliveries.get@2",
        input: { deliveryId: "delivery_1" },
      },
      {
        securityContext: {
          kind: "human",
          workspaceId: "workspace_1",
          userId: "member_1",
          role: "member",
        },
      },
    );
  });

  it("requires and forwards the Quota Wait resume idempotency header", async () => {
    const missing = await POST(request({
      capability: "quota_waits.resume@1",
      input: { waitId: "wait_1" },
    }), undefined);
    expect(missing.status).toBe(400);
    expect(mockDispatch).not.toHaveBeenCalled();

    mockDispatch.mockResolvedValueOnce({
      type: "capability_result",
      capability: { name: "quota_waits.resume", version: 1 },
      requestDigest: `sha256:${"a".repeat(64)}`,
      status: "completed",
      output: { schema: "quota-wait/v1", id: "wait_1", state: "resumed" },
      warnings: [],
    });
    const response = await POST(request({
      capability: "quota_waits.resume@1",
      input: { waitId: "wait_1" },
    }, { idempotencyKey: "resume-wait-1" }), undefined);
    expect(response.status).toBe(200);
    expect(mockDispatch).toHaveBeenCalledWith(
      {
        capability: "quota_waits.resume@1",
        input: { waitId: "wait_1" },
      },
      {
        securityContext: expect.objectContaining({
          idempotencyKey: "resume-wait-1",
        }),
      },
    );
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
    const retryWithoutKey = await POST(request({
      capability: "publishing_deliveries.retry@1",
      input: {
        ...input,
        approvalRequestId: "approval_retry_1",
        expectedFailureEvidenceDigest: `sha256:${"d".repeat(64)}`,
      },
    }), undefined);
    expect(retryWithoutKey.status).toBe(400);
    const crossCommandFields = await POST(request({
      capability: "publishing_deliveries.reconcile@1",
      input: {
        ...input,
        expectedFailureEvidenceDigest: `sha256:${"d".repeat(64)}`,
        idempotencyKey: "retry-delivery-1",
      },
    }), undefined);
    expect(crossCommandFields.status).toBe(400);
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
