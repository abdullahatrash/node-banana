import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const dispatchCapability = vi.hoisted(() => vi.fn());

vi.mock("@/lib/agent-runtime/server-dispatcher", () => ({ dispatchCapability }));
vi.mock("@/lib/studio/withStudioAuth", () => ({
  withStudioAuth:
    (_options: unknown, handler: (...args: unknown[]) => unknown) =>
    (request: NextRequest) => handler(request, {
      authorized: true,
      workspaceId: "workspace_1",
      userId: "user_1",
      role: "admin",
    }),
}));

import { POST } from "./route";

function request(capability: string, input: Record<string, unknown> = {}, workspaceId = "workspace_1") {
  return new NextRequest("http://localhost/api/studio/runs/capabilities", {
    method: "POST",
    headers: { "content-type": "application/json", "x-workspace-id": workspaceId },
    body: JSON.stringify({ capability, input }),
  });
}

describe("Studio Workflow Run capability facade", () => {
  beforeEach(() => {
    dispatchCapability.mockReset();
    dispatchCapability.mockResolvedValue({
      type: "capability_result",
      capability: { name: "workflow_runs.get", version: 2 },
      output: { id: "run_1", state: "running" },
    });
  });

  it("dispatches an authorized human through the canonical shared v2 query", async () => {
    const input = { workflowId: "workflow_1", runId: "run_1" };
    const response = await POST(request("workflow_runs.get@2", input));
    expect(response.status).toBe(200);
    expect(dispatchCapability).toHaveBeenCalledWith(
      { capability: "workflow_runs.get@2", input },
      { securityContext: { kind: "human", workspaceId: "workspace_1", userId: "user_1", role: "admin" } },
    );
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      capability: "workflow_runs.get@2",
    });
  });

  it("rejects cross-Workspace, mutation, and agent-only v1 invocations", async () => {
    expect((await POST(request("workflow_runs.get@2", {}, "workspace_2"))).status).toBe(403);
    expect((await POST(request("workflow_runs.start@2"))).status).toBe(400);
    expect((await POST(request("workflow_run_events.list@1"))).status).toBe(400);
    expect(dispatchCapability).not.toHaveBeenCalled();
  });

  it("returns only the safe capability error surface", async () => {
    dispatchCapability.mockResolvedValueOnce({
      type: "capability_error",
      category: "internal",
      code: "WORKFLOW_RUN_PERSISTENCE_UNAVAILABLE",
      message: "Run evidence is temporarily unavailable.",
      operatorTraceRef: "otr_0123456789abcdef0123456789abcdef",
    });
    const response = await POST(request("workflow_runs.get@2"));
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: "Run evidence is temporarily unavailable.",
      code: "WORKFLOW_RUN_PERSISTENCE_UNAVAILABLE",
      operatorTraceRef: "otr_0123456789abcdef0123456789abcdef",
    });
  });
});
