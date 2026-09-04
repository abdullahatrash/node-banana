import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ options: [] as unknown[], configure: vi.fn(), list: vi.fn() }));
vi.mock("@/lib/studio/withStudioAuth", () => ({ withStudioAuth: (options: unknown, handler: (...args: unknown[]) => unknown) => { mocks.options.push(options); return (request: NextRequest) => handler(request, { workspaceId: "workspace-1", userId: "user-1" }); } }));
vi.mock("@/lib/product-surfaces/youtube-trend-discovery", async (original) => {
  const actual = await original<Record<string, unknown>>();
  return { ...actual, configureYoutubeTrendDiscovery: (...args: unknown[]) => mocks.configure(...args), listYoutubeTrendDiscovery: (...args: unknown[]) => mocks.list(...args) };
});

import { GET, POST } from "./route";

const enable = { action: "enable", regionCode: "SA", categoryId: "0", displayName: "Saudi chart", scheduleMinutes: 360, pageSize: 25 };

describe("YouTube trend discovery API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.configure.mockResolvedValue({ id: "youtube-most-popular:SA:0", state: "active" });
    mocks.list.mockResolvedValue({ capability: { configured: false }, sources: [], entries: [] });
  });

  it("uses analytics-write authorization for strict source configuration", async () => {
    const response = await POST(new NextRequest("http://localhost/api/product-inspiration/youtube", { method: "POST", headers: { "content-type": "application/json", "x-workspace-id": "workspace-1" }, body: JSON.stringify(enable) }));
    expect(response.status).toBe(201);
    expect(mocks.options).toContainEqual({ route: "/api/product-inspiration/youtube", action: "write", permission: "product:analytics:write" });
    expect(mocks.configure).toHaveBeenCalledWith({ workspaceId: "workspace-1", userId: "user-1", ...enable });
  });

  it("rejects cross-workspace and oversized or too-frequent configurations", async () => {
    const crossWorkspace = await POST(new NextRequest("http://localhost/api/product-inspiration/youtube", { method: "POST", headers: { "content-type": "application/json", "x-workspace-id": "other" }, body: JSON.stringify(enable) }));
    const tooFrequent = await POST(new NextRequest("http://localhost/api/product-inspiration/youtube", { method: "POST", headers: { "content-type": "application/json", "x-workspace-id": "workspace-1" }, body: JSON.stringify({ ...enable, scheduleMinutes: 5, pageSize: 100 }) }));
    expect(crossWorkspace.status).toBe(400);
    expect(tooFrequent.status).toBe(400);
    expect(mocks.configure).not.toHaveBeenCalled();
  });

  it("lists token-free source and chart state with private no-store caching", async () => {
    const response = await GET(new NextRequest("http://localhost/api/product-inspiration/youtube"));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.list).toHaveBeenCalledWith("workspace-1");
  });
});
