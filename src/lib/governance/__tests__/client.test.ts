import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ workspaceId: vi.fn() }));
vi.mock("@/lib/studio/client", () => ({ getActiveWorkspaceId: () => mocks.workspaceId() }));

import { executeGovernanceCommand } from "../client";

describe("governance mutation client idempotency", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mocks.workspaceId.mockReturnValue("workspace-a");
  });

  it("reuses one stable key after transport loss and mints a new key for a new submission", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new TypeError("network interrupted"))
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true, result: { portfolioId: "portfolio-1" } }), { status: 200, headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true, result: { portfolioId: "portfolio-2" } }), { status: 200, headers: { "content-type": "application/json" } }));

    await expect(executeGovernanceCommand({ type: "create_portfolio", name: "One" })).resolves.toEqual({ portfolioId: "portfolio-1" });
    await expect(executeGovernanceCommand({ type: "create_portfolio", name: "Two" })).resolves.toEqual({ portfolioId: "portfolio-2" });

    const keys = fetchMock.mock.calls.map(([, init]) => new Headers(init?.headers).get("idempotency-key"));
    expect(keys[0]).toBeTruthy();
    expect(keys[1]).toBe(keys[0]);
    expect(keys[2]).not.toBe(keys[0]);
  });
});
