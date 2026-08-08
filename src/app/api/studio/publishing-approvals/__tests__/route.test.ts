import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { PublishingApprovalServiceError } from "@/lib/agent-runtime/publishing-approvals/errors";

const mockAuthorizeStudioRequest = vi.fn();
const mockList = vi.fn();
const mockInspectForHuman = vi.fn();
const mockDecide = vi.fn();

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

vi.mock("@/lib/agent-runtime/publishing-approvals/production", () => ({
  PRODUCTION_PUBLISHING_APPROVAL_SERVICE: {
    list: (...args: unknown[]) => mockList(...args),
    inspectForHuman: (...args: unknown[]) => mockInspectForHuman(...args),
    decide: (...args: unknown[]) => mockDecide(...args),
  },
}));

import { GET as LIST } from "../route";
import { GET, POST } from "../[approvalRequestId]/route";

const DIGEST = `sha256:${"a".repeat(64)}`;
const context = {
  params: Promise.resolve({ approvalRequestId: "par_request_1" }),
};

function authorize(role: "owner" | "admin" | "member" = "owner") {
  mockAuthorizeStudioRequest.mockResolvedValue({
    authorized: true,
    userId: "human_1",
    workspaceId: "workspace_1",
    role,
  });
}

function request(method = "GET", body?: Record<string, unknown>) {
  return new NextRequest(
    "http://localhost:3000/api/studio/publishing-approvals/par_request_1",
    {
      method,
      headers: {
        "x-workspace-id": "workspace_1",
        ...(method === "POST"
          ? {
              origin: "http://localhost:3000",
              "content-type": "application/json",
              "idempotency-key": "human-retry-key-123",
            }
          : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    },
  );
}

describe("human Publishing Approval routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authorize();
    mockList.mockResolvedValue([]);
    mockInspectForHuman.mockResolvedValue({
      schema: "publishing-approval-presentation/v1",
      targets: [],
    });
    mockDecide.mockResolvedValue({ id: "par_request_1", status: "approved" });
  });

  it("scopes human list access to the authenticated user and Workspace", async () => {
    const response = await LIST(
      new NextRequest(
        "http://localhost:3000/api/studio/publishing-approvals?status=pending",
        { headers: { "x-workspace-id": "workspace_1" } },
      ),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mockList).toHaveBeenCalledWith({
      workspaceId: "workspace_1",
      filters: { status: "pending" },
      limit: 50,
      viewer: { kind: "human", userId: "human_1" },
    });
  });

  it("derives the Human Principal and sends only the inspected decision to service", async () => {
    const response = await POST(
      request("POST", {
        decision: "approved",
        expectedInspectionDigest: DIGEST,
      }),
      context,
    );

    expect(response.status).toBe(200);
    expect(mockDecide).toHaveBeenCalledWith({
      workspaceId: "workspace_1",
      userId: "human_1",
      idempotencyKey: "human-retry-key-123",
      approvalRequestId: "par_request_1",
      expectedInspectionDigest: DIGEST,
      decision: "approved",
    });
  });

  it("does not treat owner or admin role as Approval Authority", async () => {
    authorize("owner");
    mockDecide.mockRejectedValue(
      new PublishingApprovalServiceError(
        "PUBLISHING_APPROVAL_AUTHORITY_REQUIRED",
        "Explicit current Approval Authority is required.",
      ),
    );

    const response = await POST(
      request("POST", {
        decision: "approved",
        expectedInspectionDigest: DIGEST,
      }),
      context,
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      code: "PUBLISHING_APPROVAL_AUTHORITY_REQUIRED",
    });
  });

  it("rejects Agent-authenticated traffic before the decision service", async () => {
    mockAuthorizeStudioRequest.mockResolvedValue({
      authorized: false,
      status: 401,
      error: "A signed-in Human Principal is required.",
    });

    const response = await POST(
      request("POST", {
        decision: "approved",
        expectedInspectionDigest: DIGEST,
      }),
      context,
    );

    expect(response.status).toBe(401);
    expect(mockDecide).not.toHaveBeenCalled();
  });

  it("rejects caller-supplied identity, target, authority, or reason claims", async () => {
    const response = await POST(
      request("POST", {
        decision: "denied",
        expectedInspectionDigest: DIGEST,
        userId: "attacker",
        channelIds: ["other_channel"],
        authority: true,
        reason: "unbounded audit text",
      }),
      context,
    );

    expect(response.status).toBe(400);
    expect(mockDecide).not.toHaveBeenCalled();
  });

  it("does not treat transport acknowledgement or confirmation as a decision", async () => {
    const response = await POST(
      request("POST", {
        confirmed: true,
        accepted: true,
        expectedInspectionDigest: DIGEST,
      }),
      context,
    );

    expect(response.status).toBe(400);
    expect(mockDecide).not.toHaveBeenCalled();
  });

  it("maps a stale inspected view to a retryable conflict", async () => {
    mockDecide.mockRejectedValue(
      new PublishingApprovalServiceError(
        "PUBLISHING_APPROVAL_STALE_VIEW",
        "Refresh the exact Approval request before deciding.",
      ),
    );

    const response = await POST(
      request("POST", {
        decision: "denied",
        expectedInspectionDigest: DIGEST,
      }),
      context,
    );

    expect(response.status).toBe(409);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("uses the authenticated human for exact historical inspection", async () => {
    const response = await GET(request(), context);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mockInspectForHuman).toHaveBeenCalledWith({
      workspaceId: "workspace_1",
      userId: "human_1",
      approvalRequestId: "par_request_1",
    });
    expect(mockDecide).not.toHaveBeenCalled();
  });
});
