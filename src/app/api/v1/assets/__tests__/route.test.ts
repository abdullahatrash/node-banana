import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

import { getPermissionsForRole } from "@/lib/studio/authz";

const {
  mockAuthorize,
  mockIsDatabaseConfigured,
  mockListWorkspaceAssets,
  mockGetProject,
  mockRecordPending,
  mockFinalizeAssetUpload,
  mockCanUseS3Storage,
  mockBuildAssetObjectKey,
  mockBuildCdnDownloadUrl,
  mockCreatePresignedDownload,
  mockPutObjectToS3,
} = vi.hoisted(() => ({
  mockAuthorize: vi.fn(),
  mockIsDatabaseConfigured: vi.fn(() => true),
  mockListWorkspaceAssets: vi.fn(),
  mockGetProject: vi.fn(),
  mockRecordPending: vi.fn(),
  mockFinalizeAssetUpload: vi.fn(),
  mockCanUseS3Storage: vi.fn(),
  mockBuildAssetObjectKey: vi.fn(),
  mockBuildCdnDownloadUrl: vi.fn(),
  mockCreatePresignedDownload: vi.fn(),
  mockPutObjectToS3: vi.fn(),
}));

const { MockStudioAssetQuotaExceededError } = vi.hoisted(() => {
  class StudioAssetQuotaExceededError extends Error {
    constructor() {
      super("Workspace storage quota exceeded.");
      this.name = "StudioAssetQuotaExceededError";
    }
  }
  return { MockStudioAssetQuotaExceededError: StudioAssetQuotaExceededError };
});

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
  buildAssetObjectKey: (...args: unknown[]) => mockBuildAssetObjectKey(...args),
  buildCdnDownloadUrl: (...args: unknown[]) => mockBuildCdnDownloadUrl(...args),
  createPresignedDownload: (...args: unknown[]) => mockCreatePresignedDownload(...args),
  putObjectToS3: (...args: unknown[]) => mockPutObjectToS3(...args),
  streamUploadToS3: vi.fn(),
  deleteObjectFromS3: vi.fn(),
}));

vi.mock("@/lib/studio/repository", () => ({
  getWorkspaceById: vi.fn(),
  listWorkspaceAssets: (...args: unknown[]) => mockListWorkspaceAssets(...args),
  getProject: (...args: unknown[]) => mockGetProject(...args),
  recordPendingS3AssetWithQuota: (...args: unknown[]) => mockRecordPending(...args),
  finalizeAssetUpload: (...args: unknown[]) => mockFinalizeAssetUpload(...args),
  StudioAssetQuotaExceededError: MockStudioAssetQuotaExceededError,
}));

vi.mock("@/lib/social/repository", () => ({
  listSocialAccounts: vi.fn(),
}));

import { GET, POST } from "../route";

function createRequest(url: string, headers?: HeadersInit): NextRequest {
  return {
    headers: new Headers(headers),
    nextUrl: new URL(url),
  } as unknown as NextRequest;
}

function createPostRequest(body: unknown, headers?: HeadersInit): NextRequest {
  return {
    headers: new Headers(headers),
    nextUrl: new URL(BASE),
    json: async () => body,
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

const BASE = "http://localhost:3000/api/v1/assets";

beforeEach(() => {
  vi.clearAllMocks();
  mockIsDatabaseConfigured.mockReturnValue(true);
  mockCanUseS3Storage.mockReturnValue(true);
  mockBuildAssetObjectKey.mockReturnValue("workspace/ws_1/unscoped/image/file.png");
  mockBuildCdnDownloadUrl.mockReturnValue(null);
  mockCreatePresignedDownload.mockResolvedValue({
    key: "workspace/ws_1/unscoped/image/file.png",
    downloadUrl: "https://signed.example/file.png",
    expiresInSeconds: 900,
  });
  mockRecordPending.mockResolvedValue({ id: "asset_new" });
  mockFinalizeAssetUpload.mockResolvedValue({ id: "asset_new" });
});

describe("/api/v1/assets GET", () => {
  it("returns 503 when the database is not configured", async () => {
    mockIsDatabaseConfigured.mockReturnValue(false);

    const response = await GET(
      createRequest(BASE, { authorization: "Bearer nb_valid" }),
    );

    expect(response.status).toBe(503);
  });

  it("lists assets and forwards type/limit filters from the query string", async () => {
    mockAuthorize.mockResolvedValue(authorized("ws_1"));
    mockListWorkspaceAssets.mockResolvedValue([
      {
        id: "asset_1",
        workspaceId: "ws_1",
        projectId: null,
        type: "image",
        mimeType: "image/png",
        sizeBytes: 1024,
        width: 256,
        height: 256,
        durationSeconds: null,
        createdAt: new Date("2026-02-01T00:00:00.000Z"),
      },
    ]);

    const response = await GET(
      createRequest(`${BASE}?type=image&limit=5`, {
        authorization: "Bearer nb_valid",
      }),
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.assets[0].id).toBe("asset_1");
    expect(mockListWorkspaceAssets).toHaveBeenCalledWith("ws_1", {
      type: "image",
      limit: 5,
    });
    expect(mockAuthorize).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ permission: "assets:read" }),
    );
  });

  it("returns a structured 400 for an invalid limit", async () => {
    mockAuthorize.mockResolvedValue(authorized("ws_1"));

    const response = await GET(
      createRequest(`${BASE}?limit=abc`, {
        authorization: "Bearer nb_valid",
      }),
    );
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error.code).toBe("invalid_input");
    expect(mockListWorkspaceAssets).not.toHaveBeenCalled();
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
    );

    expect(response.status).toBe(401);
    expect(mockListWorkspaceAssets).not.toHaveBeenCalled();
  });
});

describe("/api/v1/assets POST", () => {
  it("returns 503 when the database is not configured", async () => {
    mockIsDatabaseConfigured.mockReturnValue(false);

    const response = await POST(
      createPostRequest(
        { assetType: "image", base64Content: "aGVsbG8=" },
        { authorization: "Bearer nb_valid" },
      ),
    );

    expect(response.status).toBe(503);
  });

  it("uploads base64 content and returns the new asset id + download url", async () => {
    mockAuthorize.mockResolvedValue(authorized("ws_1"));

    const response = await POST(
      createPostRequest(
        { assetType: "image", fileName: "photo.png", base64Content: "aGVsbG8=" },
        { authorization: "Bearer nb_valid" },
      ),
    );
    const data = await response.json();

    expect(response.status).toBe(201);
    expect(data.success).toBe(true);
    expect(data.assetId).toBe("asset_new");
    expect(data.downloadUrl).toBe("https://signed.example/file.png");
    expect(mockRecordPending).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: "ws_1", type: "image" }),
    );
    expect(mockAuthorize).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ permission: "assets:write" }),
    );
  });

  it("returns a structured 400 when neither base64Content nor sourceUrl is given", async () => {
    mockAuthorize.mockResolvedValue(authorized("ws_1"));

    const response = await POST(
      createPostRequest(
        { assetType: "image" },
        { authorization: "Bearer nb_valid" },
      ),
    );
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error.code).toBe("invalid_input");
    expect(mockRecordPending).not.toHaveBeenCalled();
  });

  it("returns a structured 403 when the workspace storage quota is exceeded", async () => {
    mockAuthorize.mockResolvedValue(authorized("ws_1"));
    mockRecordPending.mockRejectedValue(new MockStudioAssetQuotaExceededError());

    const response = await POST(
      createPostRequest(
        { assetType: "image", base64Content: "aGVsbG8=" },
        { authorization: "Bearer nb_valid" },
      ),
    );
    const data = await response.json();

    expect(response.status).toBe(403);
    expect(data.success).toBe(false);
    expect(data.error.code).toBe("forbidden");
  });

  it("returns a structured 400 for an invalid JSON body", async () => {
    mockAuthorize.mockResolvedValue(authorized("ws_1"));
    const request = {
      headers: new Headers({ authorization: "Bearer nb_valid" }),
      nextUrl: new URL(BASE),
      json: async () => {
        throw new SyntaxError("Unexpected end of JSON input");
      },
    } as unknown as NextRequest;

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error.code).toBe("invalid_input");
    expect(mockRecordPending).not.toHaveBeenCalled();
  });

  it("passes through the auth layer's 401 for an invalid token", async () => {
    mockAuthorize.mockResolvedValue({
      authorized: false,
      response: NextResponse.json(
        { success: false, error: "Invalid or revoked API token." },
        { status: 401 },
      ),
    });

    const response = await POST(
      createPostRequest(
        { assetType: "image", base64Content: "aGVsbG8=" },
        { authorization: "Bearer nb_bogus" },
      ),
    );

    expect(response.status).toBe(401);
    expect(mockRecordPending).not.toHaveBeenCalled();
  });
});
