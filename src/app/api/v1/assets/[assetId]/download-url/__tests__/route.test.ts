import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

import { getPermissionsForRole } from "@/lib/studio/authz";

const {
  mockAuthorize,
  mockIsDatabaseConfigured,
  mockGetAsset,
  mockCanUseS3Storage,
  mockBuildCdnDownloadUrl,
  mockCreatePresignedDownload,
} = vi.hoisted(() => ({
  mockAuthorize: vi.fn(),
  mockIsDatabaseConfigured: vi.fn(() => true),
  mockGetAsset: vi.fn(),
  mockCanUseS3Storage: vi.fn(),
  mockBuildCdnDownloadUrl: vi.fn(),
  mockCreatePresignedDownload: vi.fn(),
}));

vi.mock("@/lib/auth/server", () => ({
  auth: { api: { getSession: vi.fn() } },
}));

vi.mock("@/lib/db", () => ({
  isDatabaseConfigured: () => mockIsDatabaseConfigured(),
  getDb: vi.fn(),
}));

vi.mock("@/lib/api-tokens/auth", () => ({
  authorizePublicApiRequest: (...args: unknown[]) => mockAuthorize(...args),
}));

vi.mock("@/lib/storage", () => ({
  canUseS3Storage: (...args: unknown[]) => mockCanUseS3Storage(...args),
  buildCdnDownloadUrl: (...args: unknown[]) => mockBuildCdnDownloadUrl(...args),
  createPresignedDownload: (...args: unknown[]) => mockCreatePresignedDownload(...args),
}));

vi.mock("@/lib/studio/repository", () => ({
  getAsset: (...args: unknown[]) => mockGetAsset(...args),
}));

import { GET } from "../route";

function createRequest(url: string, headers?: HeadersInit): NextRequest {
  return {
    headers: new Headers(headers),
    nextUrl: new URL(url),
  } as unknown as NextRequest;
}

function authorized(workspaceId = "ws_1") {
  return {
    authorized: true,
    session: {
      user: { id: `apitoken:${workspaceId}`, name: null, email: null },
      workspace: { id: workspaceId, organizationId: null },
      role: "owner" as const,
      planTier: "free" as const,
      permissions: getPermissionsForRole("owner"),
    },
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

const BASE = "http://localhost:3000/api/v1/assets/asset_1/download-url";

function context(assetId = "asset_1") {
  return { params: Promise.resolve({ assetId }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockIsDatabaseConfigured.mockReturnValue(true);
  mockCanUseS3Storage.mockReturnValue(true);
  mockBuildCdnDownloadUrl.mockReturnValue(null);
  mockCreatePresignedDownload.mockResolvedValue({
    key: "workspace/ws_1/unscoped/image/file.png",
    downloadUrl: "https://signed.example/file.png",
    expiresInSeconds: 900,
  });
});

describe("/api/v1/assets/[assetId]/download-url GET", () => {
  it("returns 503 when the database is not configured", async () => {
    mockIsDatabaseConfigured.mockReturnValue(false);

    const response = await GET(
      createRequest(BASE, { authorization: "Bearer nb_valid" }),
      context(),
    );

    expect(response.status).toBe(503);
  });

  it("returns a presigned download url for a ready asset", async () => {
    mockAuthorize.mockResolvedValue(authorized("ws_1"));
    mockGetAsset.mockResolvedValue(readyAsset());

    const response = await GET(
      createRequest(BASE, { authorization: "Bearer nb_valid" }),
      context("asset_1"),
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.assetId).toBe("asset_1");
    expect(data.downloadUrl).toBe("https://signed.example/file.png");
    expect(mockGetAsset).toHaveBeenCalledWith("ws_1", "asset_1");
    expect(mockAuthorize).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ permission: "assets:read" }),
    );
  });

  it("returns a structured 404 when the asset does not exist", async () => {
    mockAuthorize.mockResolvedValue(authorized("ws_1"));
    mockGetAsset.mockResolvedValue(null);

    const response = await GET(
      createRequest(BASE, { authorization: "Bearer nb_valid" }),
      context("asset_missing"),
    );
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data.success).toBe(false);
    expect(data.error.code).toBe("not_found");
  });

  it("passes through the auth layer's 401 for an invalid token", async () => {
    mockAuthorize.mockResolvedValue({
      authorized: false,
      response: NextResponse.json(
        { success: false, error: "Invalid or revoked API token." },
        { status: 401 },
      ),
    });

    const response = await GET(
      createRequest(BASE, { authorization: "Bearer nb_bogus" }),
      context(),
    );

    expect(response.status).toBe(401);
    expect(mockGetAsset).not.toHaveBeenCalled();
  });
});
