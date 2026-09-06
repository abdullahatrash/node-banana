import { beforeEach, describe, expect, it, vi } from "vitest";

const captured = vi.hoisted(() => ({ options: null as Record<string, unknown> | null }));

vi.mock("@/lib/studio/withStudioAuth", () => ({
  withStudioAuth: (options: Record<string, unknown>, handler: (...args: unknown[]) => unknown) => {
    captured.options = options;
    return (request: Request) => handler(request, { workspaceId: "workspace-a", userId: "user-a" });
  },
}));

import { POST } from "../route";

function request(origin = "http://localhost") {
  return new Request("http://localhost/api/preferences/workspace", {
    method: "POST",
    headers: { origin, "x-workspace-id": "workspace-a" },
  });
}

describe("POST /api/preferences/workspace", () => {
  beforeEach(() => vi.clearAllMocks());

  it("requires an explicit read capability and persists only the authorized Workspace", async () => {
    expect(captured.options).toEqual({ route: "/api/preferences/workspace", action: "read", permission: "product:read" });
    const response = await POST(request() as never, undefined as never);
    expect(response.status).toBe(204);
    expect(response.headers.get("set-cookie")).toContain("TASMEEMAI_ACTIVE_WORKSPACE=workspace-a");
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
  });

  it("rejects cross-origin attempts before changing the compatibility cookie", async () => {
    const response = await POST(request("https://attacker.example") as never, undefined as never);
    expect(response.status).toBe(403);
    expect(response.headers.get("set-cookie")).toBeNull();
  });
});
