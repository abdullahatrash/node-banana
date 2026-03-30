import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const mockAuthorizeStudioRequest = vi.fn();
const mockGetProject = vi.fn();
const mockRecordPending = vi.fn();
const mockFinalizeAssetUpload = vi.fn();
const mockCreateMultipartUpload = vi.fn();
const mockPresignUploadPart = vi.fn();
const mockCompleteMultipartUpload = vi.fn();
const mockAbortMultipartUpload = vi.fn();
const mockBuildAssetObjectKey = vi.fn();

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
  createMultipartUpload: (...args: unknown[]) => mockCreateMultipartUpload(...args),
  presignUploadPart: (...args: unknown[]) => mockPresignUploadPart(...args),
  completeMultipartUpload: (...args: unknown[]) => mockCompleteMultipartUpload(...args),
  abortMultipartUpload: (...args: unknown[]) => mockAbortMultipartUpload(...args),
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

describe("/api/studio/assets/presign-multipart", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockBuildAssetObjectKey.mockReturnValue("env/dev/ws/ws_1/proj/proj_1/video/key.mp4");
    mockRecordPending.mockResolvedValue({ id: "asset_1" });
    mockFinalizeAssetUpload.mockResolvedValue({ id: "asset_1" });
    mockCreateMultipartUpload.mockResolvedValue({ uploadId: "upload_123", key: "key.mp4" });
    mockPresignUploadPart.mockImplementation(({ partNumber }: { partNumber: number }) =>
      Promise.resolve({ uploadUrl: `https://presigned/${partNumber}`, partNumber }),
    );
    mockAuthorizeStudioRequest.mockResolvedValue({
      authorized: true,
      userId: "user_1",
      workspaceId: "ws_1",
      role: "member",
    });
  });

  it("returns 400 for invalid action", async () => {
    const response = await POST(createRequest({ action: "invalid" }));
    expect(response.status).toBe(400);
  });

  it("returns 401 for unauthenticated request", async () => {
    mockAuthorizeStudioRequest.mockResolvedValue({
      authorized: false,
      status: 401,
      error: "Please sign in.",
    });

    const response = await POST(
      createRequest({ action: "create", assetType: "video", contentType: "video/mp4", expectedSizeBytes: 1000, totalParts: 2 }),
    );
    expect(response.status).toBe(401);
  });

  describe("create action", () => {
    it("initiates multipart upload and returns part URLs", async () => {
      const response = await POST(
        createRequest({
          action: "create",
          assetType: "video",
          contentType: "video/mp4",
          expectedSizeBytes: 200 * 1024 * 1024,
          totalParts: 3,
        }),
      );
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.assetId).toBe("asset_1");
      expect(data.uploadId).toBe("upload_123");
      expect(data.partUrls).toHaveLength(3);
      expect(mockCreateMultipartUpload).toHaveBeenCalled();
      expect(mockPresignUploadPart).toHaveBeenCalledTimes(3);
    });

    it("returns 400 for invalid totalParts", async () => {
      const response = await POST(
        createRequest({
          action: "create",
          assetType: "video",
          contentType: "video/mp4",
          expectedSizeBytes: 1000,
          totalParts: 0,
        }),
      );
      expect(response.status).toBe(400);
    });

    it("returns 403 when quota exceeded", async () => {
      mockRecordPending.mockRejectedValue(new MockStudioAssetQuotaExceededError());

      const response = await POST(
        createRequest({
          action: "create",
          assetType: "video",
          contentType: "video/mp4",
          expectedSizeBytes: 1000,
          totalParts: 1,
        }),
      );
      expect(response.status).toBe(403);
    });
  });

  describe("complete action", () => {
    it("completes multipart upload and finalizes asset", async () => {
      const response = await POST(
        createRequest({
          action: "complete",
          assetId: "asset_1",
          key: "env/dev/ws/ws_1/key.mp4",
          uploadId: "upload_123",
          parts: [
            { partNumber: 1, eTag: '"etag1"' },
            { partNumber: 2, eTag: '"etag2"' },
          ],
          sizeBytes: 200 * 1024 * 1024,
        }),
      );
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(mockCompleteMultipartUpload).toHaveBeenCalled();
      expect(mockFinalizeAssetUpload).toHaveBeenCalledWith(
        expect.objectContaining({ uploadState: "ready" }),
      );
    });

    it("returns 400 for missing parts", async () => {
      const response = await POST(
        createRequest({
          action: "complete",
          assetId: "asset_1",
          key: "key.mp4",
          uploadId: "upload_123",
          parts: [],
          sizeBytes: 100,
        }),
      );
      expect(response.status).toBe(400);
    });
  });

  describe("abort action", () => {
    it("aborts multipart upload and fails asset", async () => {
      const response = await POST(
        createRequest({
          action: "abort",
          assetId: "asset_1",
          key: "env/dev/ws/ws_1/key.mp4",
          uploadId: "upload_123",
        }),
      );
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(mockAbortMultipartUpload).toHaveBeenCalled();
      expect(mockFinalizeAssetUpload).toHaveBeenCalledWith(
        expect.objectContaining({ uploadState: "failed" }),
      );
    });
  });
});
