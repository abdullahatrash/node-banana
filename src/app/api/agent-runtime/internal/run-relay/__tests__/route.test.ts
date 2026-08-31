import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const isDatabaseConfigured = vi.fn(() => true);
const relayNext = vi.fn();

vi.mock("@/lib/db", () => ({ isDatabaseConfigured }));
vi.mock("@/lib/agent-runtime/runs/production", () => ({
  PRODUCTION_WORKFLOW_RUN_SERVICE: { relayNext },
}));

function request(secret = "relay-secret", batch = 20) {
  return new NextRequest(
    `http://localhost/api/agent-runtime/internal/run-relay?batch=${batch}`,
    {
      method: "POST",
      headers: { authorization: `Bearer ${secret}` },
    },
  );
}

describe("Agent Runtime Workflow Run relay", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.AGENT_RUNTIME_INTERNAL_SECRET = "relay-secret";
    delete process.env.CRON_SECRET;
    isDatabaseConfigured.mockReturnValue(true);
  });

  it("rejects an unauthenticated caller", async () => {
    const { POST } = await import("../route");
    const response = await POST(request("wrong-secret"));
    expect(response.status).toBe(401);
    expect(relayNext).not.toHaveBeenCalled();
  });

  it("drains a bounded batch without returning internal identities", async () => {
    relayNext
      .mockResolvedValueOnce({ delivered: true, runId: "run_1" })
      .mockResolvedValueOnce({ delivered: true, runId: "run_2" })
      .mockResolvedValueOnce({ delivered: false });
    const { POST } = await import("../route");
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, delivered: 2 });
    expect(relayNext).toHaveBeenCalledTimes(3);
  });

  it("fails closed without persistence or configured authentication", async () => {
    const { POST } = await import("../route");
    isDatabaseConfigured.mockReturnValue(false);
    await expect(POST(request())).resolves.toMatchObject({ status: 503 });
    isDatabaseConfigured.mockReturnValue(true);
    delete process.env.AGENT_RUNTIME_INTERNAL_SECRET;
    await expect(POST(request())).resolves.toMatchObject({ status: 503 });
  });

  it("returns only a stable delivery error when the relay fails", async () => {
    relayNext.mockRejectedValue(new Error("sensitive queue detail"));
    const { POST } = await import("../route");
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain("sensitive");
  });
});
