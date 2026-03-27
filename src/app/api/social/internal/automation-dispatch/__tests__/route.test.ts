import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mockIsDatabaseConfigured = vi.fn(() => true);
const mockClaimDueAutomationTasks = vi.fn();
const mockGetAutomationRule = vi.fn();
const mockCreateSocialPost = vi.fn();
const mockGetSocialAccount = vi.fn();
const mockUpdatePostStatus = vi.fn();
const mockUpdateAutomationTask = vi.fn();
const mockIncrementAutomationRuleRunCount = vi.fn();
const mockCreateAutomationTask = vi.fn();

vi.mock("@/lib/db", () => ({
  isDatabaseConfigured: (...args: unknown[]) => mockIsDatabaseConfigured(...args),
}));

vi.mock("@/lib/social/repository", () => ({
  claimDueAutomationTasks: (...args: unknown[]) => mockClaimDueAutomationTasks(...args),
  getAutomationRule: (...args: unknown[]) => mockGetAutomationRule(...args),
  createSocialPost: (...args: unknown[]) => mockCreateSocialPost(...args),
  getSocialAccount: (...args: unknown[]) => mockGetSocialAccount(...args),
  updatePostStatus: (...args: unknown[]) => mockUpdatePostStatus(...args),
  updateAutomationTask: (...args: unknown[]) => mockUpdateAutomationTask(...args),
  incrementAutomationRuleRunCount: (...args: unknown[]) =>
    mockIncrementAutomationRuleRunCount(...args),
  createAutomationTask: (...args: unknown[]) => mockCreateAutomationTask(...args),
  buildAutomationTaskKey: ({
    workspaceId,
    ruleId,
    runIndex,
  }: {
    workspaceId: string;
    ruleId: string;
    runIndex: number;
  }) => `${workspaceId}:${ruleId}:${runIndex}`,
}));

vi.mock("@/utils/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

function createRequest(
  url = "http://localhost:3000/api/social/internal/automation-dispatch",
  withSecret = true,
) {
  return new NextRequest(url, {
    method: "POST",
    headers: withSecret
      ? {
          "x-social-internal-secret": "secret_123",
        }
      : undefined,
  });
}

describe("/api/social/internal/automation-dispatch POST", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SOCIAL_INTERNAL_API_SECRET = "secret_123";
    mockGetSocialAccount.mockResolvedValue({
      id: "sacct_1",
      workspaceId: "ws_1",
    });
  });

  it("returns 401 for unauthorized request", async () => {
    const { POST } = await import("../route");
    const response = await POST(createRequest(undefined, false));

    expect(response.status).toBe(401);
  });

  it("claims due tasks, queues posts, and reschedules repeat runs", async () => {
    const now = new Date("2026-03-27T12:00:00.000Z");
    mockClaimDueAutomationTasks.mockResolvedValue([
      {
        id: "atask_1",
        workspaceId: "ws_1",
        ruleId: "arule_1",
        taskKey: "ws_1:arule_1:1",
        runIndex: 1,
        dueAt: now,
        input: {},
      },
    ]);
    mockGetAutomationRule.mockResolvedValue({
      id: "arule_1",
      workspaceId: "ws_1",
      enabled: true,
      repeatIntervalSeconds: 3600,
      maxRuns: 3,
      totalRuns: 0,
      triggerSource: "schedule",
      triggerFilters: null,
      actionType: "create_social_post",
      actionConfig: { socialAccountId: "sacct_1", content: "hello" },
      createdByUserId: "user_1",
    });
    mockCreateSocialPost.mockResolvedValue({
      id: "spost_1",
    });
    mockUpdatePostStatus.mockResolvedValue({});
    mockIncrementAutomationRuleRunCount.mockResolvedValue({
      id: "arule_1",
      workspaceId: "ws_1",
      repeatIntervalSeconds: 3600,
      maxRuns: 3,
      totalRuns: 1,
    });
    mockUpdateAutomationTask.mockResolvedValue({});
    mockCreateAutomationTask.mockResolvedValue({
      id: "atask_2",
      taskKey: "ws_1:arule_1:2",
    });

    const { POST } = await import("../route");
    const response = await POST(createRequest());
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.summary).toEqual({
      scanned: 1,
      claimed: 1,
      succeeded: 1,
      failed: 0,
      cancelled: 0,
      rescheduled: 1,
      queuedPosts: 1,
    });
    expect(mockCreateSocialPost).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "ws_1",
        socialAccountId: "sacct_1",
        createdByUserId: "user_1",
      }),
    );
    expect(mockCreateAutomationTask).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "ws_1",
        ruleId: "arule_1",
        taskKey: "ws_1:arule_1:2",
        runIndex: 2,
      }),
    );
  });

  it("cancels task when maxRuns has been reached", async () => {
    mockClaimDueAutomationTasks.mockResolvedValue([
      {
        id: "atask_1",
        workspaceId: "ws_1",
        ruleId: "arule_1",
        taskKey: "ws_1:arule_1:9",
        runIndex: 9,
        dueAt: new Date(),
        input: {},
      },
    ]);
    mockGetAutomationRule.mockResolvedValue({
      id: "arule_1",
      workspaceId: "ws_1",
      enabled: true,
      repeatIntervalSeconds: 3600,
      maxRuns: 5,
      totalRuns: 5,
      triggerSource: "schedule",
      triggerFilters: null,
      actionType: "create_social_post",
      actionConfig: { socialAccountId: "sacct_1" },
      createdByUserId: "user_1",
    });
    mockUpdateAutomationTask.mockResolvedValue({});

    const { POST } = await import("../route");
    const response = await POST(createRequest());
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.summary.cancelled).toBe(1);
    expect(mockCreateSocialPost).not.toHaveBeenCalled();
    expect(mockUpdateAutomationTask).toHaveBeenCalledWith(
      "ws_1",
      "atask_1",
      expect.objectContaining({
        state: "cancelled",
      }),
    );
  });

  it("cancels task on nested automation context input", async () => {
    mockClaimDueAutomationTasks.mockResolvedValue([
      {
        id: "atask_1",
        workspaceId: "ws_1",
        ruleId: "arule_1",
        taskKey: "ws_1:arule_1:1",
        runIndex: 1,
        dueAt: new Date(),
        input: {
          workflowContext: {
            automation: {
              ruleId: "arule_loop",
            },
          },
        },
      },
    ]);
    mockGetAutomationRule.mockResolvedValue({
      id: "arule_1",
      workspaceId: "ws_1",
      enabled: true,
      repeatIntervalSeconds: 3600,
      maxRuns: 10,
      totalRuns: 0,
      triggerSource: "schedule",
      triggerFilters: null,
      actionType: "create_social_post",
      actionConfig: { socialAccountId: "sacct_1" },
      createdByUserId: "user_1",
    });
    mockUpdateAutomationTask.mockResolvedValue({});

    const { POST } = await import("../route");
    const response = await POST(createRequest());
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.summary.cancelled).toBe(1);
    expect(mockCreateSocialPost).not.toHaveBeenCalled();
    expect(mockUpdateAutomationTask).toHaveBeenCalledWith(
      "ws_1",
      "atask_1",
      expect.objectContaining({
        state: "cancelled",
        errorMessage: expect.stringContaining("Nested automation context"),
      }),
    );
  });

  it("fails task when socialAccountId is outside workspace", async () => {
    mockClaimDueAutomationTasks.mockResolvedValue([
      {
        id: "atask_1",
        workspaceId: "ws_1",
        ruleId: "arule_1",
        taskKey: "ws_1:arule_1:1",
        runIndex: 1,
        dueAt: new Date(),
        input: {},
      },
    ]);
    mockGetAutomationRule.mockResolvedValue({
      id: "arule_1",
      workspaceId: "ws_1",
      enabled: true,
      repeatIntervalSeconds: 3600,
      maxRuns: 10,
      totalRuns: 0,
      triggerSource: "schedule",
      triggerFilters: null,
      actionType: "create_social_post",
      actionConfig: { socialAccountId: "sacct_foreign" },
      createdByUserId: "user_1",
    });
    mockGetSocialAccount.mockRejectedValue(new Error("not found"));
    mockUpdateAutomationTask.mockResolvedValue({});

    const { POST } = await import("../route");
    const response = await POST(createRequest());
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.summary.failed).toBe(1);
    expect(mockCreateSocialPost).not.toHaveBeenCalled();
    expect(mockUpdateAutomationTask).toHaveBeenCalledWith(
      "ws_1",
      "atask_1",
      expect.objectContaining({
        state: "failed",
        errorMessage: expect.stringContaining("does not belong to this workspace"),
      }),
    );
  });
});
