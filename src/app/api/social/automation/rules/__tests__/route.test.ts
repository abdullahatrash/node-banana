import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const mockWithApiPermission = vi.fn();
const mockListAutomationRules = vi.fn();
const mockCreateAutomationRule = vi.fn();
const mockCreateAutomationTask = vi.fn();
const mockBuildAutomationTaskKey = vi.fn();

vi.mock("@/lib/db", () => ({
  isDatabaseConfigured: vi.fn(() => true),
}));

vi.mock("@/lib/studio/authz", () => ({
  withApiPermission: (...args: unknown[]) => mockWithApiPermission(...args),
  authzErrorResponse: (result: { status: number; error: string }) =>
    NextResponse.json({ success: false, error: result.error }, { status: result.status }),
}));

vi.mock("@/lib/social/repository", () => ({
  listAutomationRules: (...args: unknown[]) => mockListAutomationRules(...args),
  createAutomationRule: (...args: unknown[]) => mockCreateAutomationRule(...args),
  createAutomationTask: (...args: unknown[]) => mockCreateAutomationTask(...args),
  buildAutomationTaskKey: (...args: unknown[]) => mockBuildAutomationTaskKey(...args),
}));

function createRequest(url: string, init?: RequestInit): NextRequest {
  return new NextRequest(url, init as ConstructorParameters<typeof NextRequest>[1]);
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

describe("/api/social/automation/rules", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockBuildAutomationTaskKey.mockReturnValue("ws_1:arule_1:1");
  });

  it("returns 401 for unauthenticated requests", async () => {
    unauthorized(401);
    const { GET } = await import("../route");
    const response = await GET(
      createRequest("http://localhost:3000/api/social/automation/rules"),
    );

    expect(response.status).toBe(401);
  });

  it("lists rules for workspace", async () => {
    authorized();
    mockListAutomationRules.mockResolvedValue([{ id: "arule_1" }]);

    const { GET } = await import("../route");
    const response = await GET(
      createRequest("http://localhost:3000/api/social/automation/rules?enabled=true"),
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(mockListAutomationRules).toHaveBeenCalledWith("ws_1", {
      enabled: true,
      triggerSource: undefined,
      limit: undefined,
      offset: undefined,
    });
  });

  it("validates repeatIntervalSeconds bounds", async () => {
    authorized();
    const { POST } = await import("../route");
    const response = await POST(
      createRequest("http://localhost:3000/api/social/automation/rules", {
        method: "POST",
        body: JSON.stringify({
          name: "rule",
          repeatIntervalSeconds: 5,
        }),
      }),
    );
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(mockCreateAutomationRule).not.toHaveBeenCalled();
  });

  it("rejects triggerSource automation to prevent loops", async () => {
    authorized();
    const { POST } = await import("../route");
    const response = await POST(
      createRequest("http://localhost:3000/api/social/automation/rules", {
        method: "POST",
        body: JSON.stringify({
          name: "Loop rule",
          triggerSource: "automation",
        }),
      }),
    );
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(String(data.error)).toContain("blocked");
    expect(mockCreateAutomationRule).not.toHaveBeenCalled();
  });

  it("rejects nested automation context in action config", async () => {
    authorized();
    const { POST } = await import("../route");
    const response = await POST(
      createRequest("http://localhost:3000/api/social/automation/rules", {
        method: "POST",
        body: JSON.stringify({
          name: "Nested context rule",
          actionConfig: {
            socialAccountId: "sacct_1",
            workflowContext: {
              automation: {
                ruleId: "arule_existing",
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
    expect(mockCreateAutomationRule).not.toHaveBeenCalled();
  });

  it("creates rule and initial task with deterministic task key", async () => {
    authorized();
    mockCreateAutomationRule.mockResolvedValue({
      id: "arule_1",
      workspaceId: "ws_1",
      enabled: true,
    });
    mockCreateAutomationTask.mockResolvedValue({
      id: "atask_1",
      taskKey: "ws_1:arule_1:1",
      runIndex: 1,
    });

    const { POST } = await import("../route");
    const response = await POST(
      createRequest("http://localhost:3000/api/social/automation/rules", {
        method: "POST",
        body: JSON.stringify({
          name: "Repeat queue",
          triggerSource: "schedule",
          repeatIntervalSeconds: 3600,
          maxRuns: 10,
          actionConfig: { socialAccountId: "sacct_1" },
        }),
      }),
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(mockCreateAutomationRule).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "ws_1",
        name: "Repeat queue",
        repeatIntervalSeconds: 3600,
        maxRuns: 10,
      }),
    );
    expect(mockBuildAutomationTaskKey).toHaveBeenCalledWith({
      workspaceId: "ws_1",
      ruleId: "arule_1",
      runIndex: 1,
    });
    expect(mockCreateAutomationTask).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "ws_1",
        ruleId: "arule_1",
        taskKey: "ws_1:arule_1:1",
        runIndex: 1,
      }),
    );
  });
});
