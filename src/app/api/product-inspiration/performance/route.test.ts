import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ options: [] as unknown[], record: vi.fn() }));
vi.mock("@/lib/studio/withStudioAuth", () => ({
  withStudioAuth: (options: unknown, handler: (...args: unknown[]) => unknown) => {
    mocks.options.push(options);
    return (request: NextRequest) => handler(request, { workspaceId: "workspace-1", userId: "user-1", role: "admin" });
  },
}));
vi.mock("@/lib/product-surfaces/workspace-performance-observations", async (original) => {
  const actual = await original<Record<string, unknown>>();
  return { ...actual, recordWorkspacePerformanceObservation: (...args: unknown[]) => mocks.record(...args) };
});

import { POST } from "./route";

const body = {
  postId: "post-1", sourceAssetId: "asset-1", rightsSnapshot: { id: "rights-1", revision: 1, digest: `sha256:${"a".repeat(64)}` },
  sourceRef: "workspace-dashboard:2026-09-04", metrics: { views: 12000, likes: 900, comments: 40 }, observedAt: "2026-09-04T12:00:00.000Z",
  region: "GCC", contentLanguage: "ar", arabicVariety: "gulf", format: "video_hook_demo", tags: ["launch"], idempotencyKey: "performance-key-1",
};

describe("Workspace-owned performance observation API", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.record.mockResolvedValue({ kind: "created", observation: { id: "observation-1" } }); });

  it("requires the analytics-write capability", () => {
    expect(mocks.options).toContainEqual({ route: "/api/product-inspiration/performance", action: "write", permission: "product:analytics:write" });
  });

  it("records a strict, no-store observation", async () => {
    const response = await POST(new NextRequest("http://localhost/api/product-inspiration/performance", { method: "POST", headers: { "content-type": "application/json", "x-workspace-id": "workspace-1" }, body: JSON.stringify(body) }));
    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(mocks.record).toHaveBeenCalledWith({ workspaceId: "workspace-1", userId: "user-1", ...body });
  });

  it("rejects cross-Workspace and fabricated metric inputs", async () => {
    const crossWorkspace = await POST(new NextRequest("http://localhost/api/product-inspiration/performance", { method: "POST", headers: { "content-type": "application/json", "x-workspace-id": "workspace-2" }, body: JSON.stringify(body) }));
    const fractional = await POST(new NextRequest("http://localhost/api/product-inspiration/performance", { method: "POST", headers: { "content-type": "application/json", "x-workspace-id": "workspace-1" }, body: JSON.stringify({ ...body, metrics: { ...body.metrics, views: 1.5 } }) }));
    expect(crossWorkspace.status).toBe(400);
    expect(fractional.status).toBe(400);
    expect(mocks.record).not.toHaveBeenCalled();
  });

  it("returns a bounded validation error for malformed JSON", async () => {
    const response = await POST(new NextRequest("http://localhost/api/product-inspiration/performance", { method: "POST", headers: { "content-type": "application/json", "x-workspace-id": "workspace-1" }, body: "{" }));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ success: false, code: "PERFORMANCE_OBSERVATION_INVALID" });
    expect(mocks.record).not.toHaveBeenCalled();
  });
});
