import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ options: [] as unknown[], configure: vi.fn(), list: vi.fn() }));
vi.mock("@/lib/studio/withStudioAuth", () => ({ withStudioAuth: (options: unknown, handler: (...args: unknown[]) => unknown) => { mocks.options.push(options); return (request: NextRequest) => handler(request, { workspaceId: "workspace-1", userId: "user-1" }); } }));
vi.mock("@/lib/product-surfaces/social-performance-sync", async (original) => {
  const actual = await original<Record<string, unknown>>();
  return { ...actual, configurePerformanceSync: (...args: unknown[]) => mocks.configure(...args), listPerformanceSyncs: (...args: unknown[]) => mocks.list(...args) };
});

import { GET, POST } from "./route";

const enable = { action: "enable", postId: "post-1", sourceAssetId: "asset-1", rightsSnapshot: { id: "rights-1", revision: 1, digest: `sha256:${"a".repeat(64)}` }, scheduleMinutes: 60, region: "GCC", contentLanguage: "ar", arabicVariety: "gulf", format: "video_hook_demo", tags: ["launch"] };

describe("verified performance sync API", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.configure.mockResolvedValue({ id: "sync-1", state: "active" }); mocks.list.mockResolvedValue([]); });

  it("uses analytics write authorization and creates a strict sync", async () => {
    const response = await POST(new NextRequest("http://localhost/api/product-inspiration/performance/syncs", { method: "POST", headers: { "content-type": "application/json", "x-workspace-id": "workspace-1" }, body: JSON.stringify(enable) }));
    expect(mocks.options).toContainEqual({ route: "/api/product-inspiration/performance/syncs", action: "write", permission: "product:analytics:write" });
    expect(response.status).toBe(201);
    expect(mocks.configure).toHaveBeenCalledWith({ workspaceId: "workspace-1", userId: "user-1", ...enable });
  });

  it("rejects cross-workspace requests and lists token-free status", async () => {
    const denied = await POST(new NextRequest("http://localhost/api/product-inspiration/performance/syncs", { method: "POST", headers: { "content-type": "application/json", "x-workspace-id": "other" }, body: JSON.stringify(enable) }));
    expect(denied.status).toBe(400);
    const listed = await GET(new NextRequest("http://localhost/api/product-inspiration/performance/syncs"));
    expect(listed.status).toBe(200);
    expect(mocks.list).toHaveBeenCalledWith("workspace-1");
  });
});
