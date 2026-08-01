import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const mockAuthorize = vi.fn();
const mockDispatch = vi.fn();

vi.mock("@/lib/db", () => ({
  isDatabaseConfigured: () => true,
  getDb: vi.fn(),
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
    getDefinition: ({ name }: { name: string }) => ({
      idempotency: {
        mode: [
          "observability_retention.set",
          "telemetry_operator_grants.issue",
          "support_bundles.create",
        ].includes(name)
          ? "key-required"
          : "retry-safe",
      },
    }),
  },
}));
vi.mock("@/lib/agent-runtime/safe-diagnostics", () => ({
  recordSafeOperationalTrace: vi.fn(),
}));

import { POST } from "./route";

function request(
  capability: string,
  input: Record<string, unknown> = {},
  options: { idempotencyKey?: string; workspaceId?: string } = {},
) {
  return new NextRequest(
    "http://localhost/api/studio/observability/capabilities",
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

describe("Studio observability capability facade", () => {
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
      capability: { name: "operational_metrics.list", version: 1 },
      requestDigest: `sha256:${"a".repeat(64)}`,
      status: "completed",
      output: {
        schema: "operational-metric-page/v1",
        items: [],
        nextCursor: null,
      },
      warnings: [],
    });
  });

  it("uses write-route authorization and context-owned identity", async () => {
    const response = await POST(
      request("operational_metrics.list@1", { limit: 50, cursor: null }),
      undefined,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(mockAuthorize).toHaveBeenCalledWith(
      expect.any(NextRequest),
      expect.objectContaining({ action: "write" }),
    );
    expect(mockDispatch).toHaveBeenCalledWith(
      {
        capability: "operational_metrics.list@1",
        input: { limit: 50, cursor: null },
      },
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
    "observability_retention.set@1",
    "telemetry_operator_grants.issue@1",
    "support_bundles.create@1",
  ])("requires a transport idempotency key for %s", async (capability) => {
    const response = await POST(request(capability), undefined);
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: "IDEMPOTENCY_KEY_REQUIRED",
    });
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it("passes the validated key only through server-owned context", async () => {
    const input = {
      scopes: ["trace.read"],
      expiresAt: "2026-08-02T00:00:00.000Z",
    };
    await POST(
      request("telemetry_operator_grants.issue@1", input, {
        idempotencyKey: "grant-owner-123",
      }),
      undefined,
    );
    expect(mockDispatch).toHaveBeenCalledWith(
      { capability: "telemetry_operator_grants.issue@1", input },
      {
        securityContext: expect.objectContaining({
          userId: "owner_1",
          idempotencyKey: "grant-owner-123",
        }),
      },
    );
  });

  it("preserves member denial before dispatch and rejects unrelated identities", async () => {
    mockAuthorize.mockResolvedValueOnce({
      authorized: false,
      status: 403,
      error: "You do not have access to this workspace.",
    });
    expect(
      (await POST(request("operational_metrics.list@1"), undefined)).status,
    ).toBe(403);
    expect(mockDispatch).not.toHaveBeenCalled();

    mockAuthorize.mockResolvedValueOnce({
      authorized: true,
      workspaceId: "workspace_1",
      userId: "owner_1",
      role: "owner",
    });
    expect(
      (await POST(request("workflow_runs.start@2"), undefined)).status,
    ).toBe(400);
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it("does not enumerate grant-gated resources through error mapping", async () => {
    mockDispatch.mockResolvedValueOnce({
      type: "capability_error",
      capability: { name: "diagnostic_traces.get", version: 1 },
      requestDigest: `sha256:${"a".repeat(64)}`,
      code: "OBSERVABILITY_UNAVAILABLE",
      category: "not_found",
      message: "The selected observability resource is unavailable.",
      retryable: false,
      operatorTraceRef: `otr_${"a".repeat(32)}`,
    });
    const response = await POST(
      request("diagnostic_traces.get@1", {
        operatorTraceRef: `otr_${"b".repeat(32)}`,
        operatorGrantId: "grant_foreign",
      }),
      undefined,
    );
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      code: "OBSERVABILITY_UNAVAILABLE",
      error: "The selected observability resource is unavailable.",
    });
  });
});
