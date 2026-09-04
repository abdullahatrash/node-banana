import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ options: [] as unknown[], feed: vi.fn(), refresh: vi.fn(), submit: vi.fn(), queue: vi.fn() }));
vi.mock("@/lib/studio/withStudioAuth", () => ({
  withStudioAuth: (options: unknown, handler: (...args: unknown[]) => unknown) => {
    mocks.options.push(options);
    return (request: NextRequest) => handler(request, { authorized: true, workspaceId: "workspace-1", userId: "user-1", role: "admin" });
  },
}));
vi.mock("@/lib/product-surfaces/trend-feed", async (original) => ({ ...(await original<Record<string, unknown>>()), listInspirationTrendFeed: (...args: unknown[]) => mocks.feed(...args) }));
vi.mock("@/lib/product-surfaces/trend-ingestion-repository", () => ({ requestWorkspaceTrendRefresh: (...args: unknown[]) => mocks.refresh(...args) }));
vi.mock("@/lib/product-surfaces/inspiration-commands", () => ({ InspirationAdmissionError: class extends Error {}, submitInspirationCommand: (...args: unknown[]) => mocks.submit(...args), queueInspirationCommand: (...args: unknown[]) => mocks.queue(...args) }));

import { GET, POST } from "./route";

describe("product Inspiration discovery API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.feed.mockResolvedValue([]);
    mocks.refresh.mockResolvedValue({ scheduled: 0, replayed: 0 });
    mocks.submit.mockResolvedValue({ id: "manual-1" });
  });

  it("uses explicit read and write authorization boundaries", () => {
    expect(mocks.options).toEqual(expect.arrayContaining([
      { route: "/api/product-inspiration", action: "read", permission: "product:read" },
      { route: "/api/product-inspiration", action: "write", permission: "product:inspiration:write" },
    ]));
  });

  it("lists a filtered, no-store discovery feed", async () => {
    const response = await GET(new NextRequest("http://localhost/api/product-inspiration?region=GCC&language=ar&blitzReady=true&limit=20"));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(mocks.feed).toHaveBeenCalledWith({ workspaceId: "workspace-1", filters: expect.objectContaining({ region: "GCC", language: "ar", blitzReady: true, limit: 20 }) });
  });

  it("rejects restricted-rights and oversized feed requests", async () => {
    expect((await GET(new NextRequest("http://localhost/api/product-inspiration?rightsStatus=restricted"))).status).toBe(400);
    expect((await GET(new NextRequest("http://localhost/api/product-inspiration?limit=101"))).status).toBe(400);
    expect((await GET(new NextRequest("http://localhost/api/product-inspiration?blitzReady=yes"))).status).toBe(400);
    expect(mocks.feed).not.toHaveBeenCalled();
  });

  it("durably schedules refreshes without requiring a configured adapter", async () => {
    const response = await POST(new NextRequest("http://localhost/api/product-inspiration", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "refresh", idempotencyKey: "refresh-key-1" }) }));
    expect(response.status).toBe(202);
    expect(mocks.refresh).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: "workspace-1", userId: "user-1", idempotencyKey: "refresh-key-1" }));
    expect(mocks.submit).not.toHaveBeenCalled();
  });

  it("preserves manual source submission", async () => {
    const body = { action: "submit", title: "Owned clip", sourceName: "Workspace", sourceAssetId: "asset-1", rightsSnapshotId: "rights-1", region: "GCC", contentLanguage: "ar", arabicVariety: null, format: "video_hook_demo", tags: ["launch"], idempotencyKey: "manual-key-1" };
    const response = await POST(new NextRequest("http://localhost/api/product-inspiration", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
    expect(response.status).toBe(201);
    expect(mocks.submit).toHaveBeenCalledWith({ workspaceId: "workspace-1", userId: "user-1", ...body });
  });
});
