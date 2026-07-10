import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ContentOSSession } from "@/lib/studio/authz";
import { getPermissionsForRole } from "@/lib/studio/authz";

const { mockGetAsset, mockBuildCdnDownloadUrl, mockCreatePresignedDownload, mockCanUseS3Storage } =
  vi.hoisted(() => ({
    mockGetAsset: vi.fn(),
    mockBuildCdnDownloadUrl: vi.fn(),
    mockCreatePresignedDownload: vi.fn(),
    mockCanUseS3Storage: vi.fn(),
  }));

vi.mock("@/lib/storage", () => ({
  canUseS3Storage: (...args: unknown[]) => mockCanUseS3Storage(...args),
  buildCdnDownloadUrl: (...args: unknown[]) => mockBuildCdnDownloadUrl(...args),
  createPresignedDownload: (...args: unknown[]) => mockCreatePresignedDownload(...args),
}));

vi.mock("@/lib/studio/repository", () => ({
  getAsset: (...args: unknown[]) => mockGetAsset(...args),
}));

import { runTool } from "../../runtime";
import { getAssetDownloadUrlTool } from "../get-asset-download-url";

function session(
  role: "owner" | "member" = "owner",
  workspaceId = "ws_1",
): ContentOSSession {
  return {
    user: { id: `apitoken:${workspaceId}`, name: null, email: null },
    workspace: { id: workspaceId, organizationId: null },
    role,
    planTier: "free",
    permissions: getPermissionsForRole(role),
  };
}

function readyAsset(overrides: Record<string, unknown> = {}) {
  return {
    id: "asset_1",
    storageProvider: "s3",
    storageKey: "workspace/ws_1/unscoped/image/file.png",
    metadata: { uploadState: "ready" },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockCanUseS3Storage.mockReturnValue(true);
  mockBuildCdnDownloadUrl.mockReturnValue(null);
  mockCreatePresignedDownload.mockResolvedValue({
    key: "workspace/ws_1/unscoped/image/file.png",
    downloadUrl: "https://signed.example/file.png",
    expiresInSeconds: 900,
  });
});

describe("get_asset_download_url tool", () => {
  it("returns a presigned url for a ready s3-backed asset", async () => {
    mockGetAsset.mockResolvedValue(readyAsset());

    const result = await runTool(
      getAssetDownloadUrlTool,
      { assetId: "asset_1" },
      { session: session("owner", "ws_1") },
    );

    expect(mockGetAsset).toHaveBeenCalledWith("ws_1", "asset_1");
    expect(mockCreatePresignedDownload).toHaveBeenCalledWith(
      expect.objectContaining({ key: "workspace/ws_1/unscoped/image/file.png" }),
    );
    expect(result).toEqual({
      assetId: "asset_1",
      downloadUrl: "https://signed.example/file.png",
      expiresInSeconds: 900,
    });
  });

  it("prefers a CDN url when one is configured", async () => {
    mockGetAsset.mockResolvedValue(readyAsset());
    mockBuildCdnDownloadUrl.mockReturnValue("https://cdn.example/file.png");

    const result = await runTool(
      getAssetDownloadUrlTool,
      { assetId: "asset_1" },
      { session: session("owner", "ws_1") },
    );

    expect(result.downloadUrl).toBe("https://cdn.example/file.png");
    expect(mockCreatePresignedDownload).not.toHaveBeenCalled();
  });

  it("returns not_found when the asset does not exist in this workspace", async () => {
    mockGetAsset.mockResolvedValue(null);

    const error = await runTool(
      getAssetDownloadUrlTool,
      { assetId: "asset_missing" },
      { session: session("owner", "ws_1") },
    ).catch((e) => e);

    expect(error.code).toBe("not_found");
  });

  it("rejects an asset whose upload is still pending", async () => {
    mockGetAsset.mockResolvedValue(
      readyAsset({ metadata: { uploadState: "pending" } }),
    );

    const error = await runTool(
      getAssetDownloadUrlTool,
      { assetId: "asset_1" },
      { session: session("owner", "ws_1") },
    ).catch((e) => e);

    expect(error.code).toBe("invalid_input");
    expect(mockCreatePresignedDownload).not.toHaveBeenCalled();
  });

  it("rejects an asset that is not stored in S3/R2", async () => {
    mockGetAsset.mockResolvedValue(readyAsset({ storageProvider: "local" }));

    const error = await runTool(
      getAssetDownloadUrlTool,
      { assetId: "asset_1" },
      { session: session("owner", "ws_1") },
    ).catch((e) => e);

    expect(error.code).toBe("invalid_input");
  });

  it("denies callers whose role lacks assets:read", async () => {
    const memberSession = session("member");
    memberSession.permissions = memberSession.permissions.filter(
      (p) => p !== "assets:read",
    );

    const error = await runTool(
      getAssetDownloadUrlTool,
      { assetId: "asset_1" },
      { session: memberSession },
    ).catch((e) => e);

    expect(error.code).toBe("forbidden");
    expect(mockGetAsset).not.toHaveBeenCalled();
  });
});
