import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock("@/lib/db", () => ({ isDatabaseConfigured: () => true }));
vi.mock("@/lib/studio/internal-auth", () => ({ ensureInternalStudioOrCronAuth: (request: NextRequest) => request.headers.get("authorization") === "ok" ? null : new Response(null, { status: 401 }) }));
vi.mock("@/lib/product-surfaces/youtube-trend-discovery", () => ({ runYoutubeTrendDiscoveryWorker: (...args: unknown[]) => mocks.run(...args) }));

import { GET } from "./route";

describe("YouTube trend worker route", () => {
  beforeEach(() => { mocks.run.mockReset().mockResolvedValue({ configured: false, purged: 0 }); });

  it("requires internal auth", async () => {
    expect((await GET(new NextRequest("http://localhost/api/studio/internal/youtube-trends"))).status).toBe(401);
    expect(mocks.run).not.toHaveBeenCalled();
  });

  it("clamps work and returns the fail-closed worker summary", async () => {
    const response = await GET(new NextRequest("http://localhost/api/studio/internal/youtube-trends?limit=999", { headers: { authorization: "ok", "x-vercel-id": "worker-1" } }));
    expect(response.status).toBe(200);
    expect(mocks.run).toHaveBeenCalledWith({ workerId: "worker-1", limit: 100 });
    expect(await response.json()).toEqual({ success: true, summary: { configured: false, purged: 0 } });
  });
});
