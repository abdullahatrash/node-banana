import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const mockWithApiPermission = vi.fn();
const mockListAutomationTasks = vi.fn();
const mockGetAutomationRule = vi.fn();
const mockGetNextAutomationRunIndex = vi.fn();
const mockCreateAutomationTask = vi.fn();
const mockBuildAutomationTaskKey = vi.fn();
const mockSocialPostBelongsToWorkspace = vi.fn();
const mockSocialEventBelongsToWorkspace = vi.fn();

vi.mock("@/lib/db", () => ({
  isDatabaseConfigured: vi.fn(() => true),
}));

vi.mock("@/lib/studio/authz", () => ({
  withApiPermission: (...args: unknown[]) => mockWithApiPermission(...args),
  authzErrorResponse: (result: { status: number; error: string }) =>
    NextResponse.json(
      { success: false, error: result.error },
      { status: result.status },
    ),
}));

vi.mock("@/lib/social/repository", () => ({
  listAutomationTasks: (...args: unknown[]) => mockListAutomationTasks(...args),
  getAutomationRule: (...args: unknown[]) => mockGetAutomationRule(...args),
  getNextAutomationRunIndex: (...args: unknown[]) =>
    mockGetNextAutomationRunIndex(...args),
  createAutomationTask: (...args: unknown[]) => mockCreateAutomationTask(...args),
  buildAutomationTaskKey: (...args: unknown[]) => mockBuildAutomationTaskKey(...args),
  socialPostBelongsToWorkspace: (...args: unknown[]) =>
    mockSocialPostBelongsToWorkspace(...args),
  socialEventBelongsToWorkspace: (...args: unknown[]) =>
    mockSocialEventBelongsToWorkspace(...args),
}));

function createRequest(url: string, init?: RequestInit): NextRequest {
  return new NextRequest(url, init);
}

const mockSession = {
  user: { id: "user_1", name: "Test", email: "test@example.com" },
  workspace: { id: "ws_1", organizationId: "org_1" },
  role: "owner" as const,
  planTier: "pro" as const,
  permissions: ["social:view", "social:publish"],
};

function authorized() {
  mockWithApiPermission.mockResolvedValue({
    authorized: true,
    session: mockSession,
  });
}

function unauthorized(status: 401 | 403) {
  mockWithApiPermission.mockResolvedValue({
    authorized: false,
    response: NextResponse.json(
      { success: false, error: status === 401 ? "Unauthenticated" : "Forbidden" },
      { status },
    ),
  });
}

describe("/api/social/automation/tasks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAutomationRule.mockResolvedValue({
      id: "arule_1",
      workspaceId: "ws_1",
    });
    mockGetNextAutomationRunIndex.mockResolvedValue(2);
    mockBuildAutomationTaskKey.mockReturnValue("ws_1:arule_1:2");
    mockSocialPostBelongsToWorkspace.mockResolvedValue(true);
    mockSocialEventBelongsToWorkspace.mockResolvedValue(true);
  });

  it("returns 401 for unauthenticated requests", async () => {
    unauthorized(401);
    const { POST } = await import("../route");
    const response = await POST(
      createRequest("http://localhost:3000/api/social/automation/tasks", {
        method: "POST",
        body: JSON.stringify({ ruleId: "arule_1" }),
      }),
    );

    expect(response.status).toBe(401);
  });

  it("creates task when source references belong to workspace", async () => {
    authorized();
    mockCreateAutomationTask.mockResolvedValue({
      id: "atask_1",
      workspaceId: "ws_1",
      ruleId: "arule_1",
    });

    const { POST } = await import("../route");
    const response = await POST(
      createRequest("http://localhost:3000/api/social/automation/tasks", {
        method: "POST",
        body: JSON.stringify({
          ruleId: "arule_1",
          sourcePostId: "spost_1",
          sourceEventId: "sevt_1",
          input: {
            content: "Hello",
          },
        }),
      }),
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(mockSocialPostBelongsToWorkspace).toHaveBeenCalledWith("ws_1", "spost_1");
    expect(mockSocialEventBelongsToWorkspace).toHaveBeenCalledWith("ws_1", "sevt_1");
    expect(mockCreateAutomationTask).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "ws_1",
        ruleId: "arule_1",
        taskKey: "ws_1:arule_1:2",
      }),
    );
  });

  it("rejects sourcePostId outside workspace", async () => {
    authorized();
    mockSocialPostBelongsToWorkspace.mockResolvedValue(false);

    const { POST } = await import("../route");
    const response = await POST(
      createRequest("http://localhost:3000/api/social/automation/tasks", {
        method: "POST",
        body: JSON.stringify({
          ruleId: "arule_1",
          sourcePostId: "spost_other",
        }),
      }),
    );
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data.success).toBe(false);
    expect(String(data.error)).toContain("sourcePostId");
    expect(mockCreateAutomationTask).not.toHaveBeenCalled();
  });

  it("rejects nested automation context in task input", async () => {
    authorized();

    const { POST } = await import("../route");
    const response = await POST(
      createRequest("http://localhost:3000/api/social/automation/tasks", {
        method: "POST",
        body: JSON.stringify({
          ruleId: "arule_1",
          input: {
            workflowContext: {
              automation: {
                ruleId: "arule_loop",
              },
            },
          },
        }),
      }),
    );
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(String(data.error)).toContain("Nested automation context");
    expect(mockCreateAutomationTask).not.toHaveBeenCalled();
  });
});
