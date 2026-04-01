import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const mockWithApiPermission = vi.fn();
const mockGetAutomationRule = vi.fn();
const mockUpdateAutomationRule = vi.fn();
const mockDeleteAutomationRule = vi.fn();

vi.mock("@/lib/db", () => ({
  isDatabaseConfigured: vi.fn(() => true),
}));

vi.mock("@/lib/studio/authz", () => ({
  withApiPermission: (...args: unknown[]) => mockWithApiPermission(...args),
  authzErrorResponse: (result: { status: number; error: string }) =>
    NextResponse.json({ success: false, error: result.error }, { status: result.status }),
}));

vi.mock("@/lib/social/repository", () => ({
  getAutomationRule: (...args: unknown[]) => mockGetAutomationRule(...args),
  updateAutomationRule: (...args: unknown[]) => mockUpdateAutomationRule(...args),
  deleteAutomationRule: (...args: unknown[]) => mockDeleteAutomationRule(...args),
  AutomationRuleNotFoundError: class extends Error {
    constructor(id?: string) {
      super(`Automation rule "${id}" not found.`);
      this.name = "AutomationRuleNotFoundError";
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

describe("/api/social/automation/rules/[ruleId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads rule", async () => {
    authorized();
    mockGetAutomationRule.mockResolvedValue({ id: "arule_1", name: "Rule 1" });

    const { GET } = await import("../route");
    const response = await GET(
      request("http://localhost:3000/api/social/automation/rules/arule_1"),
      { params: Promise.resolve({ ruleId: "arule_1" }) },
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(mockGetAutomationRule).toHaveBeenCalledWith("ws_1", "arule_1");
  });

  it("updates rule", async () => {
    authorized();
    mockUpdateAutomationRule.mockResolvedValue({
      id: "arule_1",
      name: "Rule 1",
      enabled: false,
    });

    const { PATCH } = await import("../route");
    const response = await PATCH(
      request("http://localhost:3000/api/social/automation/rules/arule_1", {
        method: "PATCH",
        body: JSON.stringify({ enabled: false }),
      }),
      { params: Promise.resolve({ ruleId: "arule_1" }) },
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(mockUpdateAutomationRule).toHaveBeenCalledWith(
      "ws_1",
      "arule_1",
      expect.objectContaining({ enabled: false }),
    );
  });

  it("deletes rule", async () => {
    authorized();
    mockDeleteAutomationRule.mockResolvedValue({});

    const { DELETE } = await import("../route");
    const response = await DELETE(
      request("http://localhost:3000/api/social/automation/rules/arule_1", {
        method: "DELETE",
      }),
      { params: Promise.resolve({ ruleId: "arule_1" }) },
    );

    expect(response.status).toBe(200);
    expect(mockDeleteAutomationRule).toHaveBeenCalledWith("ws_1", "arule_1");
  });
});
