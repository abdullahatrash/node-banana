import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ options: [] as unknown[], queue: vi.fn() }));

vi.mock("@/lib/studio/withStudioAuth", () => ({
  withStudioAuth: (options: unknown, handler: (...args: unknown[]) => unknown) => {
    mocks.options.push(options);
    return (request: NextRequest) => handler(request, { workspaceId: "workspace-1", userId: "user-1" });
  },
}));

vi.mock("@/lib/product-surfaces/youtube-metadata-remix", () => ({
  queueYoutubeMetadataRemix: (...args: unknown[]) => mocks.queue(...args),
  YoutubeMetadataRemixError: class YoutubeMetadataRemixError extends Error {
    constructor(readonly code: string) { super(code); }
  },
}));

import { POST } from "./route";

const body = { sourceId: "source-1", videoId: "video-1", contentLanguage: "ar", arabicVariety: "gulf", format: "video_hook_demo", idempotencyKey: "queue-key-1" };

function request(value: unknown = body, workspaceId = "workspace-1") {
  return new NextRequest("http://localhost/api/product-inspiration/youtube/queue", { method: "POST", headers: { "content-type": "application/json", "x-workspace-id": workspaceId }, body: JSON.stringify(value) });
}

describe("YouTube metadata remix queue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.queue.mockResolvedValue({ inspirationItemId: "inspiration-1", blitzItemId: "blitz-1" });
  });

  it("uses content-write authorization and queues identifiers plus locale only", async () => {
    const response = await POST(request());

    expect(response.status).toBe(201);
    expect(mocks.options).toContainEqual({ route: "/api/product-inspiration/youtube/queue", action: "write", permission: "product:content:write" });
    expect(mocks.queue).toHaveBeenCalledWith({ workspaceId: "workspace-1", userId: "user-1", ...body });
    expect(JSON.stringify(mocks.queue.mock.calls[0])).not.toContain("thumbnail");
    expect(JSON.stringify(mocks.queue.mock.calls[0])).not.toContain("transcript");
  });

  it("rejects cross-workspace, invalid Arabic locale, and unknown fields before queueing", async () => {
    const [crossWorkspace, missingVariety, injectedMedia] = await Promise.all([
      POST(request(body, "workspace-2")),
      POST(request({ ...body, arabicVariety: null })),
      POST(request({ ...body, thumbnailUrl: "https://img.youtube.com/source.jpg" })),
    ]);

    expect(crossWorkspace.status).toBe(400);
    expect(missingVariety.status).toBe(400);
    expect(injectedMedia.status).toBe(400);
    expect(mocks.queue).not.toHaveBeenCalled();
  });
});
