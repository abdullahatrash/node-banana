import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { ProviderCapabilities } from "@/lib/social/provider-interface";

const mockListProviderCapabilities = vi.fn<() => ProviderCapabilities[]>();

vi.mock("@/lib/social/provider-registry", () => ({
  registerProvider: vi.fn(),
  clearRegistry: vi.fn(),
  listProviderCapabilities: (...args: unknown[]) =>
    mockListProviderCapabilities(...(args as [])),
}));

function createRequest(): NextRequest {
  return new NextRequest("http://localhost:3000/api/social/providers");
}

describe("GET /api/social/providers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reports configured: true when a platform's env vars are set", async () => {
    mockListProviderCapabilities.mockReturnValue([
      {
        identifier: "x",
        displayName: "X (Twitter)",
        maxContentLength: 280,
        supportsImages: true,
        supportsVideo: false,
        supportsCarousel: false,
        requiresPageSelection: false,
        configured: true,
      },
    ]);

    const { GET } = await import("../route");
    const response = await GET(createRequest());
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.providers).toHaveLength(1);
    expect(data.providers[0]).toMatchObject({ identifier: "x", configured: true });
  });

  it("reports configured: false for a platform missing its env vars, without leaking var names or values", async () => {
    mockListProviderCapabilities.mockReturnValue([
      {
        identifier: "x",
        displayName: "X (Twitter)",
        maxContentLength: 280,
        supportsImages: true,
        supportsVideo: false,
        supportsCarousel: false,
        requiresPageSelection: false,
        configured: false,
      },
    ]);

    const { GET } = await import("../route");
    const response = await GET(createRequest());
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.providers[0]).toMatchObject({ identifier: "x", configured: false });
    expect(JSON.stringify(data)).not.toMatch(/X_API_KEY|X_API_SECRET|_CLIENT_ID|_CLIENT_SECRET/);
  });

  it("reports platforms with no server credential requirement as always configured", async () => {
    mockListProviderCapabilities.mockReturnValue([
      {
        identifier: "bluesky",
        displayName: "Bluesky",
        maxContentLength: 300,
        supportsImages: true,
        supportsVideo: false,
        supportsCarousel: false,
        requiresPageSelection: false,
        configured: true,
      },
    ]);

    const { GET } = await import("../route");
    const response = await GET(createRequest());
    const data = await response.json();

    expect(data.providers[0]).toMatchObject({ identifier: "bluesky", configured: true });
  });

  it("returns 500 with an error message if listing providers throws", async () => {
    mockListProviderCapabilities.mockImplementation(() => {
      throw new Error("registry exploded");
    });

    const { GET } = await import("../route");
    const response = await GET(createRequest());
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data.success).toBe(false);
    expect(data.error).toContain("registry exploded");
  });
});
