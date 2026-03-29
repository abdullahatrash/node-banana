import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const mockAuthorizeStudioRequest = vi.fn();
const mockGetProject = vi.fn();
const mockRecordPending = vi.fn();
const mockFinalizeAssetUpload = vi.fn();
const mockPutObjectToS3 = vi.fn();
const mockBuildAssetObjectKey = vi.fn();
const mockCreatePresignedDownload = vi.fn();

const { MockStudioAssetQuotaExceededError } = vi.hoisted(() => {
  class StudioAssetQuotaExceededError extends Error {
    constructor() {
      super("Workspace storage quota exceeded.");
      this.name = "StudioAssetQuotaExceededError";
    }
  }

  return { MockStudioAssetQuotaExceededError: StudioAssetQuotaExceededError };
});

vi.mock("@/lib/db", () => ({
  isDatabaseConfigured: vi.fn(() => true),
}));

vi.mock("@/lib/storage", () => ({
  canUseS3Storage: vi.fn(() => true),
  buildAssetObjectKey: (...args: unknown[]) => mockBuildAssetObjectKey(...args),
  putObjectToS3: (...args: unknown[]) => mockPutObjectToS3(...args),
  createPresignedDownload: (...args: unknown[]) => mockCreatePresignedDownload(...args),
}));

vi.mock("@/lib/studio/authz", () => ({
  authorizeStudioRequest: (...args: unknown[]) => mockAuthorizeStudioRequest(...args),
  authzErrorResponse: (result: { status: number; error: string }) =>
    NextResponse.json({ success: false, error: result.error }, { status: result.status }),
}));

vi.mock("@/lib/studio/repository", () => ({
  getProject: (...args: unknown[]) => mockGetProject(...args),
  recordPendingS3AssetWithQuota: (...args: unknown[]) => mockRecordPending(...args),
  finalizeAssetUpload: (...args: unknown[]) => mockFinalizeAssetUpload(...args),
  StudioAssetQuotaExceededError: MockStudioAssetQuotaExceededError,
}));

import { POST } from "../route";

function createRequest(body: unknown): NextRequest {
  return {
    headers: new Headers(),
    json: async () => body,
  } as unknown as NextRequest;
}

describe("/api/studio/assets/ingest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockBuildAssetObjectKey.mockReturnValue("env/dev/ws/ws_1/proj/proj_1/image/2026/03/29/key.png");
    mockRecordPending.mockResolvedValue({ id: "asset_1" });
    mockFinalizeAssetUpload.mockResolvedValue({ id: "asset_1" });
    mockCreatePresignedDownload.mockResolvedValue({
      key: "env/dev/ws/ws_1/proj/proj_1/image/2026/03/29/key.png",
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

    const response = await POST(
      createRequest({
        projectId: "proj_1",
        assetType: "image",
        sourceDataUrl: "data:image/png;base64,aGVsbG8=",
      }),
    );
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.success).toBe(false);
  });

  it("returns 400 when sourceDataUrl/sourceUrl contract is invalid", async () => {
    const response = await POST(
      createRequest({
        projectId: "proj_1",
        assetType: "image",
      }),
    );
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data).toEqual({
      success: false,
      error: "Exactly one of sourceDataUrl or sourceUrl is required.",
    });
  });

  it("uploads and finalizes data-url ingest for authorized workspace member", async () => {
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
        sourceDataUrl: "data:image/png;base64,aGVsbG8=",
        fileName: "image.png",
      }),
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({
      success: true,
      assetId: "asset_1",
      key: "env/dev/ws/ws_1/proj/proj_1/image/2026/03/29/key.png",
      downloadUrl: "https://example-download",
      expiresInSeconds: 900,
    });
    expect(mockPutObjectToS3).toHaveBeenCalled();
    expect(mockFinalizeAssetUpload).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "ws_1",
        assetId: "asset_1",
        uploadState: "ready",
      }),
    );
  });

  it("returns 403 when workspace quota is exceeded", async () => {
    mockAuthorizeStudioRequest.mockResolvedValue({
      authorized: true,
      userId: "user_1",
      workspaceId: "ws_1",
      role: "member",
    });
    mockGetProject.mockResolvedValue({ id: "proj_1", workspaceId: "ws_1" });
    mockRecordPending.mockRejectedValue(new MockStudioAssetQuotaExceededError());

    const response = await POST(
      createRequest({
        projectId: "proj_1",
        assetType: "image",
        sourceDataUrl: "data:image/png;base64,aGVsbG8=",
      }),
    );
    const data = await response.json();

    expect(response.status).toBe(403);
    expect(data).toEqual({
      success: false,
      error: "Workspace storage quota exceeded.",
    });
  });
});
