import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const mockWithApiPermission = vi.fn();
const mockGetAutomationTask = vi.fn();
const mockUpdateAutomationTask = vi.fn();
const mockDeleteAutomationTask = vi.fn();
const mockSocialPostBelongsToWorkspace = vi.fn();
const mockSocialEventBelongsToWorkspace = vi.fn();

vi.mock("@/lib/db", () => ({
  isDatabaseConfigured: vi.fn(() => true),
}));

vi.mock("@/lib/studio/authz", () => ({
  withApiPermission: (...args: unknown[]) => mockWithApiPermission(...args),
  authzErrorResponse: (result: { status: number; error: string }) =>
    NextResponse.json({ success: false, error: result.error }, { status: result.status }),
}));

vi.mock("@/lib/social/repository", () => ({
  getAutomationTask: (...args: unknown[]) => mockGetAutomationTask(...args),
  updateAutomationTask: (...args: unknown[]) => mockUpdateAutomationTask(...args),
  deleteAutomationTask: (...args: unknown[]) => mockDeleteAutomationTask(...args),
  socialPostBelongsToWorkspace: (...args: unknown[]) =>
    mockSocialPostBelongsToWorkspace(...args),
  socialEventBelongsToWorkspace: (...args: unknown[]) =>
    mockSocialEventBelongsToWorkspace(...args),
  AutomationTaskNotFoundError: class extends Error {
    constructor(id?: string) {
      super(`Automation task "${id}" not found.`);
      this.name = "AutomationTaskNotFoundError";
    }
  },
}));

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

function request(url: string, init?: RequestInit): NextRequest {
  return new NextRequest(url, init);
}

describe("/api/social/automation/tasks/[taskId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAutomationTask.mockResolvedValue({
      id: "atask_1",
      workspaceId: "ws_1",
      runIndex: 1,
      input: {},
    });
    mockSocialPostBelongsToWorkspace.mockResolvedValue(true);
    mockSocialEventBelongsToWorkspace.mockResolvedValue(true);
  });

  it("loads task", async () => {
    authorized();
    const { GET } = await import("../route");
    const response = await GET(
      request("http://localhost:3000/api/social/automation/tasks/atask_1"),
      { params: Promise.resolve({ taskId: "atask_1" }) },
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(mockGetAutomationTask).toHaveBeenCalledWith("ws_1", "atask_1");
  });

  it("updates task state", async () => {
    authorized();
    mockUpdateAutomationTask.mockResolvedValue({
      id: "atask_1",
      workspaceId: "ws_1",
      state: "cancelled",
    });

    const { PATCH } = await import("../route");
    const response = await PATCH(
      request("http://localhost:3000/api/social/automation/tasks/atask_1", {
        method: "PATCH",
        body: JSON.stringify({ state: "cancelled" }),
      }),
      { params: Promise.resolve({ taskId: "atask_1" }) },
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(mockUpdateAutomationTask).toHaveBeenCalledWith(
      "ws_1",
      "atask_1",
      expect.objectContaining({ state: "cancelled" }),
    );
  });

  it("deletes task", async () => {
    authorized();
    mockDeleteAutomationTask.mockResolvedValue({});

    const { DELETE } = await import("../route");
    const response = await DELETE(
      request("http://localhost:3000/api/social/automation/tasks/atask_1", {
        method: "DELETE",
      }),
      { params: Promise.resolve({ taskId: "atask_1" }) },
    );

    expect(response.status).toBe(200);
    expect(mockDeleteAutomationTask).toHaveBeenCalledWith("ws_1", "atask_1");
  });
});
