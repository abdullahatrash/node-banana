import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const authorizeStudioRequest = vi.fn();
const reschedule = vi.fn();
const productionCalendarRescheduleService = vi.fn(async (_input: unknown) => ({
  reschedule: (...args: unknown[]) => reschedule(...args),
}));

vi.mock("@/lib/db", () => ({ isDatabaseConfigured: () => true }));
vi.mock("@/lib/studio/authz", () => ({
  authorizeStudioRequest: (...args: unknown[]) => authorizeStudioRequest(...args),
  authzErrorResponse: (result: { status: number; error: string }) =>
    NextResponse.json({ success: false, error: result.error }, { status: result.status }),
}));
vi.mock("@/lib/product-surfaces/calendar-reschedule-production", () => ({
  calendarRescheduleInitiator: () => ({ userId: "user_1", principalId: "human:user_1", keyId: "session", authorizationEvidenceRef: "auth" }),
  productionCalendarRescheduleService: (input: unknown) => productionCalendarRescheduleService(input),
}));

import { POST } from "../reschedule/route";

const source = {
  schema: "canonical-calendar-binding/v1",
  planId: "plan_1",
  revisionId: "revision_4",
  revision: 4,
  revisionDigest: `sha256:${"a".repeat(64)}`,
  targetId: "target_1",
};

function request(body: unknown) {
  return new NextRequest("http://localhost:3000/api/studio/calendar/reschedule", {
    method: "POST",
    headers: { "content-type": "application/json", "x-workspace-id": "workspace_1" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/studio/calendar/reschedule", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authorizeStudioRequest.mockResolvedValue({ authorized: true, workspaceId: "workspace_1", userId: "user_1", role: "member", authContextId: "session_1" });
    reschedule.mockResolvedValue({ kind: "rescheduled", revision: { id: "revision_5", revision: 5 }, supersededApprovalId: null, cancellation: null, requiresApproval: true });
  });

  it("binds the mutation to exact current canonical coordinates", async () => {
    const response = await POST(request({ source, scheduledAt: "2026-10-06T10:00:00.000Z", confirmCancelReleasedDelivery: false, idempotencyKey: "calendar-request-1" }));
    expect(response.status).toBe(200);
    expect(reschedule).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: "workspace_1",
      planId: "plan_1",
      revisionId: "revision_4",
      revisionDigest: source.revisionDigest,
      expectedRevision: 4,
      targetId: "target_1",
      userId: "user_1",
      initiator: {
        userId: "user_1",
        principalId: "human:user_1",
        keyId: "session",
        authorizationEvidenceRef: "auth",
      },
    }));
    expect(productionCalendarRescheduleService).toHaveBeenCalledWith({
      workspaceId: "workspace_1",
      source: { planId: "plan_1", revisionId: "revision_4" },
      userId: "user_1",
      role: "member",
      authContextId: "session_1",
    });
  });

  it("rejects the former caller-controlled legacy post authority", async () => {
    const response = await POST(request({ postId: "post_1", scheduledAt: "2026-10-06T10:00:00.000Z", confirmCancelReleasedDelivery: false, idempotencyKey: "calendar-request-1" }));
    expect(response.status).toBe(400);
    expect(reschedule).not.toHaveBeenCalled();
  });
});
