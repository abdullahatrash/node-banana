import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const mockAuthorizeStudioRequest = vi.fn();
const mockSoftDeleteAsset = vi.fn();
const mockFinalizeAssetUpload = vi.fn();
const mockGetAsset = vi.fn();
const mockGetObjectStreamFromS3 = vi.fn();
const mockCollectStreamedAssetEvidence = vi.fn();

const {
  MockStudioAssetNotFoundError,
  MockStudioAssetUploadTransitionError,
} = vi.hoisted(() => {
  class StudioAssetNotFoundError extends Error {
    constructor() {
      super("Asset not found.");
      this.name = "StudioAssetNotFoundError";
    }
  }

  class StudioAssetUploadTransitionError extends Error {
    constructor(currentState: string, nextState: string) {
      super(`Invalid upload state transition: ${currentState} -> ${nextState}`);
      this.name = "StudioAssetUploadTransitionError";
    }
  }

  return {
    MockStudioAssetNotFoundError: StudioAssetNotFoundError,
    MockStudioAssetUploadTransitionError: StudioAssetUploadTransitionError,
  };
});

vi.mock("@/lib/db", () => ({
  isDatabaseConfigured: vi.fn(() => true),
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
  getAsset: (...args: unknown[]) => mockGetAsset(...args),
  softDeleteAsset: (...args: unknown[]) => mockSoftDeleteAsset(...args),
  finalizeAssetUpload: (...args: unknown[]) => mockFinalizeAssetUpload(...args),
  StudioAssetNotFoundError: MockStudioAssetNotFoundError,
  StudioAssetUploadTransitionError: MockStudioAssetUploadTransitionError,
}));

vi.mock("@/lib/storage", () => ({ getObjectStreamFromS3: (...args: unknown[]) => mockGetObjectStreamFromS3(...args) }));
vi.mock("@/lib/studio/asset-media-evidence", () => ({ collectStreamedAssetEvidence: (...args: unknown[]) => mockCollectStreamedAssetEvidence(...args) }));

import { DELETE, PATCH } from "../route";

function createRequest(): NextRequest {
  return {
    headers: new Headers(),
    nextUrl: new URL("http://localhost:3000/api/studio/assets/asset_1"),
  } as unknown as NextRequest;
}

function createPatchRequest(body: unknown): NextRequest {
  return {
    headers: new Headers(),
    nextUrl: new URL("http://localhost:3000/api/studio/assets/asset_1"),
    json: async () => body,
  } as unknown as NextRequest;
}

describe("/api/studio/assets/[assetId] DELETE role enforcement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 403 when a member tries to delete an asset", async () => {
    mockAuthorizeStudioRequest.mockResolvedValue({
      authorized: false,
      status: 403,
      error: "Only workspace owners and admins can perform this action.",
      reason: "forbidden",
    });

    const response = await DELETE(createRequest(), {
      params: Promise.resolve({ assetId: "asset_1" }),
    });
    const data = await response.json();

    expect(response.status).toBe(403);
    expect(data).toEqual({
      success: false,
      error: "Only workspace owners and admins can perform this action.",
    });
    expect(mockSoftDeleteAsset).not.toHaveBeenCalled();
  });

  it("returns 200 for owner/admin delete", async () => {
    mockAuthorizeStudioRequest.mockResolvedValue({
      authorized: true,
      userId: "user_1",
      workspaceId: "ws_1",
      role: "admin",
    });
    mockSoftDeleteAsset.mockResolvedValue({
      id: "asset_1",
      workspaceId: "ws_1",
      deletedAt: "2026-03-21T10:00:00.000Z",
    });

    const response = await DELETE(createRequest(), {
      params: Promise.resolve({ assetId: "asset_1" }),
    });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(mockSoftDeleteAsset).toHaveBeenCalledWith("ws_1", "asset_1");
  });
});

describe("/api/studio/assets/[assetId] PATCH finalize upload", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAsset.mockResolvedValue({ id: "asset_1", workspaceId: "ws_1", type: "image", storageProvider: "s3", storageKey: "ws_1/image.png", mimeType: "image/png", checksum: null, metadata: { uploadState: "pending", expectedSizeBytes: 1024 } });
    mockGetObjectStreamFromS3.mockResolvedValue({ body: (async function* () { yield new Uint8Array([1]); })(), contentType: "image/png", contentLength: 1024 });
    mockCollectStreamedAssetEvidence.mockResolvedValue({ sizeBytes: 1024, checksum: `sha256:${"a".repeat(64)}`, width: 100, height: 100, metadata: { dimensionEvidence: "server-media-probe/v1" } });
  });

  it("returns 401 for unauthenticated requests", async () => {
    mockAuthorizeStudioRequest.mockResolvedValue({
      authorized: false,
      status: 401,
      error: "Please sign in to access AI Studio.",
      reason: "unauthenticated",
    });

    const response = await PATCH(
      createPatchRequest({
        uploadState: "ready",
      }),
      { params: Promise.resolve({ assetId: "asset_1" }) },
    );
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data).toEqual({
      success: false,
      error: "Please sign in to access AI Studio.",
    });
  });

  it("returns 403 for non-member/no-access requests", async () => {
    mockAuthorizeStudioRequest.mockResolvedValue({
      authorized: false,
      status: 403,
      error: "You do not have access to this workspace.",
      reason: "forbidden",
    });

    const response = await PATCH(
      createPatchRequest({
        uploadState: "ready",
      }),
      { params: Promise.resolve({ assetId: "asset_1" }) },
    );
    const data = await response.json();

    expect(response.status).toBe(403);
    expect(data).toEqual({
      success: false,
      error: "You do not have access to this workspace.",
    });
    expect(mockFinalizeAssetUpload).not.toHaveBeenCalled();
  });

  it("returns 404 when asset is not found in workspace", async () => {
    mockAuthorizeStudioRequest.mockResolvedValue({
      authorized: true,
      userId: "user_1",
      workspaceId: "ws_1",
      role: "member",
    });
    mockFinalizeAssetUpload.mockRejectedValue(new MockStudioAssetNotFoundError());

    const response = await PATCH(
      createPatchRequest({
        uploadState: "ready",
      }),
      { params: Promise.resolve({ assetId: "asset_missing" }) },
    );
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data).toEqual({
      success: false,
      error: "Asset not found.",
    });
  });

  it("returns 400 for invalid payload", async () => {
    const response = await PATCH(
      createPatchRequest({
        uploadState: "pending",
      }),
      { params: Promise.resolve({ assetId: "asset_1" }) },
    );
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data).toEqual({
      success: false,
      error: "uploadState is required and must be ready or failed.",
    });
  });

  it("returns 400 when failed uploadState is missing error", async () => {
    const response = await PATCH(
      createPatchRequest({
        uploadState: "failed",
      }),
      { params: Promise.resolve({ assetId: "asset_1" }) },
    );
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data).toEqual({
      success: false,
      error: "error is required when uploadState is failed.",
    });
  });

  it("returns 400 when sizeBytes is negative", async () => {
    const response = await PATCH(
      createPatchRequest({
        uploadState: "ready",
        sizeBytes: -1,
      }),
      { params: Promise.resolve({ assetId: "asset_1" }) },
    );
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data).toEqual({
      success: false,
      error: "sizeBytes must be a non-negative number.",
    });
  });

  it("returns 200 for pending -> ready", async () => {
    mockAuthorizeStudioRequest.mockResolvedValue({
      authorized: true,
      userId: "user_1",
      workspaceId: "ws_1",
      role: "member",
    });
    mockFinalizeAssetUpload.mockResolvedValue({
      id: "asset_1",
      workspaceId: "ws_1",
      metadata: { uploadState: "ready" },
    });

    const response = await PATCH(
      createPatchRequest({
        uploadState: "ready",
        sizeBytes: 1024,
        mimeType: "image/png",
      }),
      { params: Promise.resolve({ assetId: "asset_1" }) },
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(mockFinalizeAssetUpload).toHaveBeenCalledWith({
      workspaceId: "ws_1",
      assetId: "asset_1",
      uploadState: "ready",
      sizeBytes: 1024,
      checksum: `sha256:${"a".repeat(64)}`,
      mimeType: "image/png",
      width: 100,
      height: 100,
      durationSeconds: undefined,
      metadata: { dimensionEvidence: "server-media-probe/v1" },
      error: undefined,
    });
    expect(mockCollectStreamedAssetEvidence).toHaveBeenCalledWith(expect.objectContaining({ assetType: "image", mimeType: "image/png", maximumBytes: 500 * 1024 * 1024 }));
  });

  it("returns 200 for pending -> failed", async () => {
    mockAuthorizeStudioRequest.mockResolvedValue({
      authorized: true,
      userId: "user_1",
      workspaceId: "ws_1",
      role: "member",
    });
    mockFinalizeAssetUpload.mockResolvedValue({
      id: "asset_1",
      workspaceId: "ws_1",
      metadata: { uploadState: "failed" },
    });

    const response = await PATCH(
      createPatchRequest({
        uploadState: "failed",
        error: "Upload timed out",
      }),
      { params: Promise.resolve({ assetId: "asset_1" }) },
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(mockFinalizeAssetUpload).toHaveBeenCalledWith({
      workspaceId: "ws_1",
      assetId: "asset_1",
      uploadState: "failed",
      sizeBytes: undefined,
      checksum: undefined,
      mimeType: undefined,
      width: undefined,
      height: undefined,
      durationSeconds: undefined,
      metadata: undefined,
      error: "Upload timed out",
    });
  });

  it("rejects a stored object whose size differs from the reservation", async () => {
    mockAuthorizeStudioRequest.mockResolvedValue({ authorized: true, userId: "user_1", workspaceId: "ws_1", role: "member" });
    mockGetObjectStreamFromS3.mockResolvedValue({ body: (async function* () {})(), contentType: "image/png", contentLength: 12 });
    const response = await PATCH(createPatchRequest({ uploadState: "ready", sizeBytes: 12 }), { params: Promise.resolve({ assetId: "asset_1" }) });
    expect(response.status).toBe(422);
    expect(mockFinalizeAssetUpload).not.toHaveBeenCalled();
  });

  it("returns 200 for ready -> ready idempotent", async () => {
    mockAuthorizeStudioRequest.mockResolvedValue({
      authorized: true,
      userId: "user_1",
      workspaceId: "ws_1",
      role: "member",
    });
    mockGetAsset.mockResolvedValue({ id: "asset_1", workspaceId: "ws_1", type: "image", storageProvider: "s3", storageKey: "ws_1/image.png", mimeType: "image/png", checksum: `sha256:${"b".repeat(64)}`, metadata: { uploadState: "ready" } });

    const response = await PATCH(
      createPatchRequest({
        uploadState: "ready",
      }),
      { params: Promise.resolve({ assetId: "asset_1" }) },
    );

    expect(response.status).toBe(200);
    expect(mockFinalizeAssetUpload).not.toHaveBeenCalled();
    expect(mockGetObjectStreamFromS3).not.toHaveBeenCalled();
  });

  it("returns 409 for ready -> failed", async () => {
    mockAuthorizeStudioRequest.mockResolvedValue({
      authorized: true,
      userId: "user_1",
      workspaceId: "ws_1",
      role: "member",
    });
    mockFinalizeAssetUpload.mockRejectedValue(
      new MockStudioAssetUploadTransitionError("ready", "failed"),
    );

    const response = await PATCH(
      createPatchRequest({
        uploadState: "failed",
        error: "Upload checksum mismatch",
      }),
      { params: Promise.resolve({ assetId: "asset_1" }) },
    );
    const data = await response.json();

    expect(response.status).toBe(409);
    expect(data).toEqual({
      success: false,
      error: "Invalid upload state transition: ready -> failed",
    });
  });

  it("returns 409 for failed -> ready", async () => {
    mockAuthorizeStudioRequest.mockResolvedValue({
      authorized: true,
      userId: "user_1",
      workspaceId: "ws_1",
      role: "member",
    });
    mockGetAsset.mockResolvedValue({ id: "asset_1", workspaceId: "ws_1", type: "image", storageProvider: "s3", storageKey: "ws_1/image.png", mimeType: "image/png", checksum: null, metadata: { uploadState: "failed" } });

    const response = await PATCH(
      createPatchRequest({
        uploadState: "ready",
      }),
      { params: Promise.resolve({ assetId: "asset_1" }) },
    );
    const data = await response.json();

    expect(response.status).toBe(409);
    expect(data).toEqual({
      success: false,
      error: "Invalid upload state transition: failed -> ready",
    });
  });
});
