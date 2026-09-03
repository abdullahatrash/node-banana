import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const mockAuthorizeStudioRequest = vi.fn();
const mockGetAsset = vi.fn();
const mockCreatePresignedDownload = vi.fn();
const mockBuildCdnDownloadUrl = vi.fn();
const mockRequireRegion = vi.fn(async () => undefined);

vi.mock("@/lib/governance/region-enforcement", () => ({ GOVERNANCE_REGION_ROUTES: { assetStorage: { kind: "primary_storage", routeId: "storage:workspace-assets" } }, requireGovernanceRegionRoute: (...args: unknown[]) => mockRequireRegion(...args) }));

vi.mock("@/lib/db", () => ({
  isDatabaseConfigured: vi.fn(() => true),
}));

vi.mock("@/lib/storage", () => ({
  canUseS3Storage: vi.fn(() => true),
  createPresignedDownload: (...args: unknown[]) => mockCreatePresignedDownload(...args),
  buildCdnDownloadUrl: (...args: unknown[]) => mockBuildCdnDownloadUrl(...args),
}));

vi.mock("@/lib/studio/authz", () => ({
  authorizeStudioRequest: (...args: unknown[]) => mockAuthorizeStudioRequest(...args),
  authzErrorResponse: (result: { status: number; error: string }) =>
    NextResponse.json({ success: false, error: result.error }, { status: result.status }),
}));

vi.mock("@/lib/studio/repository", () => ({
  getAsset: (...args: unknown[]) => mockGetAsset(...args),
}));

import { GET } from "../route";

function createRequest(): NextRequest {
  return {
    headers: new Headers(),
    nextUrl: new URL("http://localhost:3000/api/studio/assets/asset_1/download"),
  } as unknown as NextRequest;
}

describe("/api/studio/assets/[assetId]/download", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockBuildCdnDownloadUrl.mockReturnValue(null);
    mockCreatePresignedDownload.mockResolvedValue({
      key: "env/dev/ws/ws_1/proj/proj_1/image/2026/03/29/file.png",
      downloadUrl: "https://example-download",
      expiresInSeconds: 900,
    });
  });

  it("returns 401 for unauthenticated request", async () => {
    mockAuthorizeStudioRequest.mockResolvedValue({
      authorized: false,
      status: 401,
      error: "Please sign in to access AI Studio.",
    });

    const response = await GET(createRequest(), {
      params: Promise.resolve({ assetId: "asset_1" }),
    });
    expect(response.status).toBe(401);
  });

  it("returns 409 when upload is pending", async () => {
    mockAuthorizeStudioRequest.mockResolvedValue({
      authorized: true,
      workspaceId: "ws_1",
      role: "member",
    });
    mockGetAsset.mockResolvedValue({
      id: "asset_1",
      storageProvider: "s3",
      storageKey: "env/dev/ws/ws_1/proj/proj_1/image/2026/03/29/file.png",
      metadata: { uploadState: "pending" },
    });

    const response = await GET(createRequest(), {
      params: Promise.resolve({ assetId: "asset_1" }),
    });
    const data = await response.json();

    expect(response.status).toBe(409);
    expect(data).toEqual({
      success: false,
      error: "Asset upload is not ready.",
    });
  });

  it("returns signed download URL for ready s3 asset", async () => {
    mockAuthorizeStudioRequest.mockResolvedValue({
      authorized: true,
      workspaceId: "ws_1",
      role: "member",
    });
    mockGetAsset.mockResolvedValue({
      id: "asset_1",
      storageProvider: "s3",
      storageKey: "env/dev/ws/ws_1/proj/proj_1/image/2026/03/29/file.png",
      metadata: { uploadState: "ready" },
    });

    const response = await GET(createRequest(), {
      params: Promise.resolve({ assetId: "asset_1" }),
    });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("pragma")).toBe("no-cache");
    expect(data).toEqual({
      success: true,
      assetId: "asset_1",
      key: "env/dev/ws/ws_1/proj/proj_1/image/2026/03/29/file.png",
      downloadUrl: "https://example-download",
      expiresInSeconds: 900,
    });
  });

  it("returns CDN URL when CDN_BASE_URL is configured", async () => {
    mockAuthorizeStudioRequest.mockResolvedValue({
      authorized: true,
      workspaceId: "ws_1",
      role: "member",
    });
    mockGetAsset.mockResolvedValue({
      id: "asset_1",
      storageProvider: "s3",
      storageKey: "env/dev/ws/ws_1/proj/proj_1/image/2026/03/29/file.png",
      metadata: { uploadState: "ready" },
    });
    mockBuildCdnDownloadUrl.mockReturnValue(
      "https://cdn.example.com/env/dev/ws/ws_1/proj/proj_1/image/2026/03/29/file.png",
    );

    const response = await GET(createRequest(), {
      params: Promise.resolve({ assetId: "asset_1" }),
    });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.downloadUrl).toBe(
      "https://cdn.example.com/env/dev/ws/ws_1/proj/proj_1/image/2026/03/29/file.png",
    );
    expect(data.expiresInSeconds).toBeUndefined();
    expect(mockCreatePresignedDownload).not.toHaveBeenCalled();
  });

  it("falls back to presigned URL when CDN is not configured", async () => {
    mockAuthorizeStudioRequest.mockResolvedValue({
      authorized: true,
      workspaceId: "ws_1",
      role: "member",
    });
    mockGetAsset.mockResolvedValue({
      id: "asset_1",
      storageProvider: "s3",
      storageKey: "env/dev/ws/ws_1/proj/proj_1/image/2026/03/29/file.png",
      metadata: { uploadState: "ready" },
    });
    mockBuildCdnDownloadUrl.mockReturnValue(null);

    const response = await GET(createRequest(), {
      params: Promise.resolve({ assetId: "asset_1" }),
    });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.downloadUrl).toBe("https://example-download");
    expect(data.expiresInSeconds).toBe(900);
    expect(mockCreatePresignedDownload).toHaveBeenCalled();
  });
});
