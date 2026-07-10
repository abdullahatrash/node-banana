import { beforeEach, describe, expect, it, vi } from "vitest";

import { getPermissionsForRole } from "@/lib/studio/authz";

import { ToolError } from "../../errors";
import { runTool } from "../../runtime";

const { mockGetWorkflowRun } = vi.hoisted(() => ({
  mockGetWorkflowRun: vi.fn(),
}));

vi.mock("@/lib/workflow-runner/runsRepository", () => ({
  getWorkflowRun: (...args: unknown[]) => mockGetWorkflowRun(...args),
}));

import { getRunStatusTool } from "../get-run-status";

function ctx() {
  return {
    session: {
      user: { id: "apitoken:ws_1", name: null, email: null },
      workspace: { id: "ws_1", organizationId: null },
      role: "owner" as const,
      planTier: "free" as const,
      permissions: getPermissionsForRole("owner"),
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("get_run_status tool", () => {
  it("maps a succeeded run to status, progress, and output refs", async () => {
    mockGetWorkflowRun.mockResolvedValue({
      id: "run_1",
      status: "succeeded",
      progress: {
        nodes: [
          { nodeId: "p1", type: "prompt", status: "succeeded" },
          { nodeId: "gen1", type: "nanoBanana", status: "succeeded" },
        ],
      },
      outputs: [{ nodeId: "gen1", assetId: "asset_9", url: "https://cdn/x.png" }],
      errorCode: null,
      errorMessage: null,
    });

    const result = await runTool(getRunStatusTool, { runId: "run_1" }, ctx());

    expect(result).toEqual({
      runId: "run_1",
      status: "succeeded",
      progress: {
        nodes: [
          { nodeId: "p1", type: "prompt", status: "succeeded" },
          { nodeId: "gen1", type: "nanoBanana", status: "succeeded" },
        ],
      },
      outputs: [{ nodeId: "gen1", assetId: "asset_9", url: "https://cdn/x.png" }],
      error: null,
    });
    expect(mockGetWorkflowRun).toHaveBeenCalledWith("ws_1", "run_1");
  });

  it("surfaces a failed run's error", async () => {
    mockGetWorkflowRun.mockResolvedValue({
      id: "run_1",
      status: "failed",
      progress: { nodes: [] },
      outputs: null,
      errorCode: "internal",
      errorMessage: "provider 500",
    });

    const result = await runTool(getRunStatusTool, { runId: "run_1" }, ctx());

    expect(result.status).toBe("failed");
    expect(result.error).toEqual({ code: "internal", message: "provider 500" });
    expect(result.outputs).toEqual([]);
  });

  it("returns not_found for an unknown run", async () => {
    mockGetWorkflowRun.mockResolvedValue(null);

    let error: unknown;
    try {
      await runTool(getRunStatusTool, { runId: "nope" }, ctx());
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(ToolError);
    expect((error as ToolError).code).toBe("not_found");
  });
});
