import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const mockAuthorizeStudioRequest = vi.fn();
const mockGetProject = vi.fn();
const mockRecordAsset = vi.fn();
const mockBuildAssetObjectKey = vi.fn();
const mockCreatePresignedUpload = vi.fn();

vi.mock("@/lib/db", () => ({
  isDatabaseConfigured: vi.fn(() => true),
}));

vi.mock("@/lib/storage", () => ({
  canUseS3Storage: vi.fn(() => true),
  buildAssetObjectKey: (...args: unknown[]) => mockBuildAssetObjectKey(...args),
  createPresignedUpload: (...args: unknown[]) => mockCreatePresignedUpload(...args),
}));

vi.mock("@/lib/studio/authz", () => {
  return {
    authorizeStudioRequest: (...args: unknown[]) => mockAuthorizeStudioRequest(...args),
    authzErrorResponse: (result: { status: number; error: string }) =>
      NextResponse.json(
        {
          success: false,
          error: result.error,
        },
        { status: result.status },
      ),
  };
});

vi.mock("@/lib/studio/repository", () => ({
  getProject: (...args: unknown[]) => mockGetProject(...args),
  recordAsset: (...args: unknown[]) => mockRecordAsset(...args),
}));

import { POST } from "../route";

function createRequest(body: unknown): NextRequest {
  return {
    headers: new Headers(),
    json: async () => body,
  } as unknown as NextRequest;
}

describe("/api/studio/assets/presign auth hardening", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockBuildAssetObjectKey.mockReturnValue("ws_1/proj_1/image/file.png");
    mockCreatePresignedUpload.mockResolvedValue({
      key: "ws_1/proj_1/image/file.png",
      uploadUrl: "https://example-upload",
      downloadUrl: "https://example-download",
      expiresInSeconds: 900,
    });
    mockRecordAsset.mockResolvedValue({
      id: "asset_1",
    });
  });

  it("returns 401 for unauthenticated requests", async () => {
    mockAuthorizeStudioRequest.mockResolvedValue({
      authorized: false,
      status: 401,
      error: "Please sign in to access AI Studio.",
      reason: "unauthenticated",
    });

    const response = await POST(
      createRequest({
        projectId: "proj_1",
        assetType: "image",
        fileName: "image.png",
        contentType: "image/png",
      }),
    );
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data).toEqual({
      success: false,
      error: "Please sign in to access AI Studio.",
    });
  });

  it("returns 403 when POST references a project outside the workspace", async () => {
    mockAuthorizeStudioRequest.mockResolvedValue({
      authorized: true,
      userId: "user_1",
      workspaceId: "ws_1",
      role: "member",
    });
    mockGetProject.mockResolvedValue(null);

    const response = await POST(
      createRequest({
        projectId: "proj_other",
        assetType: "image",
        fileName: "image.png",
        contentType: "image/png",
      }),
    );
    const data = await response.json();

    expect(response.status).toBe(403);
    expect(data).toEqual({
      success: false,
      error: "No access to this project.",
    });
  });

  it("creates a presigned URL and pending asset for authorized requests", async () => {
    mockAuthorizeStudioRequest.mockResolvedValue({
      authorized: true,
      userId: "user_1",
      workspaceId: "ws_1",
      role: "member",
    });
    mockGetProject.mockResolvedValue({ id: "proj_1", workspaceId: "ws_1" });

    const response = await POST(
      createRequest({
        projectId: "proj_1",
        assetType: "image",
        fileName: "image.png",
        contentType: "image/png",
      }),
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({
      success: true,
      assetId: "asset_1",
      key: "ws_1/proj_1/image/file.png",
      uploadUrl: "https://example-upload",
      downloadUrl: "https://example-download",
      expiresInSeconds: 900,
    });
    expect(mockBuildAssetObjectKey).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "ws_1",
        projectId: "proj_1",
        assetType: "image",
      }),
    );
    expect(mockRecordAsset).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "ws_1",
        userId: "user_1",
        projectId: "proj_1",
        type: "image",
        storageProvider: "s3",
        storageKey: "ws_1/proj_1/image/file.png",
        metadata: expect.objectContaining({
          uploadState: "pending",
          originalFileName: "image.png",
          pendingExpiresAt: expect.any(String),
        }),
      }),
    );
    expect(mockAuthorizeStudioRequest).toHaveBeenCalledWith(
      expect.anything(),
      {
        route: "/api/studio/assets/presign",
        action: "write",
      },
    );
  });
});
