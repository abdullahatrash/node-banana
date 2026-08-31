import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const dispatchCapability = vi.hoisted(() => vi.fn());

vi.mock("@/lib/agent-runtime/server-dispatcher", () => ({
  dispatchCapability,
}));

vi.mock("@/lib/studio/withStudioAuth", () => ({
  withStudioAuth:
    (_options: unknown, handler: (...args: unknown[]) => unknown) =>
    (request: NextRequest) =>
      handler(request, {
        authorized: true,
        workspaceId: "workspace_1",
        userId: "user_1",
        role: "admin",
        permissions: ["workspaces:read"],
      }),
}));

import { POST } from "./route";

function request(capability: string, input: Record<string, unknown> = {}, workspaceId = "workspace_1") {
  return new NextRequest("http://localhost/api/studio/usage/capabilities", {
    method: "POST",
    headers: { "content-type": "application/json", "x-workspace-id": workspaceId },
    body: JSON.stringify({ capability, input }),
  });
}

describe("Studio Usage capability facade", () => {
  beforeEach(() => {
    dispatchCapability.mockReset();
    dispatchCapability.mockResolvedValue({
      type: "capability_result",
      capability: { name: "usage_summaries.get", version: 1 },
      requestDigest: `sha256:${"1".repeat(64)}`,
      status: "completed",
      warnings: [],
      output: {
        schema: "usage-summary/v1",
        quantityTotals: [],
        costSubtotals: [],
        unknownValuationCount: 0,
        complete: true,
      },
    });
  });

  it("routes an authorized Workspace administrator through the canonical dispatcher", async () => {
    const response = await POST(request("usage_summaries.get@1"));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      capability: "usage_summaries.get@1",
      result: { schema: "usage-summary/v1", complete: true },
    });
    expect(dispatchCapability).toHaveBeenCalledWith(
      { capability: "usage_summaries.get@1", input: {} },
      { securityContext: expect.objectContaining({ kind: "human", role: "admin", workspaceId: "workspace_1" }) },
    );
  });

  it("fails closed for a mismatched Workspace and non-read identities", async () => {
    const crossWorkspace = await POST(request("usage_summaries.get@1", {}, "workspace_2"));
    expect(crossWorkspace.status).toBe(403);
    expect(dispatchCapability).not.toHaveBeenCalled();

    const mutation = await POST(request("pricing_overrides.create@1"));
    expect(mutation.status).toBe(400);
    expect(dispatchCapability).not.toHaveBeenCalled();
  });
});
