import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const mockAuthorizeStudioRequest = vi.fn();
const mockGetProject = vi.fn();
const mockRecordPending = vi.fn();
const mockFinalizeAssetUpload = vi.fn();
const mockPutObjectToS3 = vi.fn();
const mockStreamUploadToS3 = vi.fn();
const mockDeleteObjectFromS3 = vi.fn();
const mockBuildAssetObjectKey = vi.fn();
const mockCreatePresignedDownload = vi.fn();
const mockRequireRegion = vi.fn(async () => undefined);

vi.mock("@/lib/governance/region-enforcement", () => ({ GOVERNANCE_REGION_ROUTES: { assetStorage: { kind: "primary_storage", routeId: "storage:workspace-assets" }, assetProcessing: { kind: "processing", routeId: "processing:asset-ingestion" } }, requireGovernanceRegionRoute: (...args: unknown[]) => mockRequireRegion(...args) }));

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
  streamUploadToS3: (...args: unknown[]) => mockStreamUploadToS3(...args),
  deleteObjectFromS3: (...args: unknown[]) => mockDeleteObjectFromS3(...args),
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
    mockPutObjectToS3.mockResolvedValue(undefined);
    mockStreamUploadToS3.mockResolvedValue({ sizeBytes: 5 });
    mockDeleteObjectFromS3.mockResolvedValue(undefined);
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
    mockAuthorizeStudioRequest.mockResolvedValue({
      authorized: true,
      userId: "user_1",
      workspaceId: "ws_1",
      role: "member",
    });

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
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("pragma")).toBe("no-cache");
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

  it("does not expose or persist raw source/provider failure evidence", async () => {
    mockAuthorizeStudioRequest.mockResolvedValue({
      authorized: true,
      userId: "user_1",
      workspaceId: "ws_1",
      role: "member",
    });
    const canaries = [
      "private prompt text",
      "api_key_canary_123",
      "Authorization: Bearer auth_canary",
      "Cookie: session=cookie_canary",
      "https://storage.invalid/object?X-Amz-Signature=signed_canary",
      '{"providerBody":"provider_body_canary"}',
    ];
    mockPutObjectToS3.mockRejectedValue(new Error(canaries.join(" | ")));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      const response = await POST(
        createRequest({
          assetType: "image",
          sourceDataUrl: "data:image/png;base64,aGVsbG8=",
        }),
      );
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(data).toEqual({
        success: false,
        code: "ASSET_INGEST_FAILED",
        error: "Asset ingest failed.",
      });
      expect(mockFinalizeAssetUpload).toHaveBeenCalledWith(expect.objectContaining({
        workspaceId: "ws_1",
        assetId: "asset_1",
        uploadState: "failed",
        error: "ASSET_INGEST_FAILED",
      }));
      const exposed = JSON.stringify({
        response: data,
        persisted: mockFinalizeAssetUpload.mock.calls,
        logs: consoleError.mock.calls,
      });
      for (const canary of canaries) expect(exposed).not.toContain(canary);
      expect(consoleError).not.toHaveBeenCalled();
    } finally {
      consoleError.mockRestore();
    }
  });

  it("uses putObjectToS3 for sourceDataUrl (no streaming)", async () => {
    mockAuthorizeStudioRequest.mockResolvedValue({
      authorized: true,
      userId: "user_1",
      workspaceId: "ws_1",
      role: "member",
    });

    const response = await POST(
      createRequest({
        assetType: "image",
        sourceDataUrl: "data:image/png;base64,aGVsbG8=",
      }),
    );

    expect(response.status).toBe(200);
    expect(mockPutObjectToS3).toHaveBeenCalled();
    expect(mockStreamUploadToS3).not.toHaveBeenCalled();
  });

  it("uses streamUploadToS3 for sourceUrl (streaming path)", async () => {
    mockAuthorizeStudioRequest.mockResolvedValue({
      authorized: true,
      userId: "user_1",
      workspaceId: "ws_1",
      role: "member",
    });
    mockStreamUploadToS3.mockResolvedValue({ sizeBytes: 1024 });

    // Mock global fetch for the remote URL
    const mockBody = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3]));
        controller.close();
      },
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ "content-type": "image/png", "content-length": "1024" }),
      body: mockBody,
    });

    try {
      const response = await POST(
        createRequest({
          assetType: "image",
          sourceUrl: "https://example.com/image.png",
        }),
      );
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(mockStreamUploadToS3).toHaveBeenCalled();
      expect(mockPutObjectToS3).not.toHaveBeenCalled();
      expect(mockFinalizeAssetUpload).toHaveBeenCalledWith(
        expect.objectContaining({
          uploadState: "ready",
          sizeBytes: 1024,
        }),
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("deletes object and fails asset when stream exceeds max size", async () => {
    mockAuthorizeStudioRequest.mockResolvedValue({
      authorized: true,
      userId: "user_1",
      workspaceId: "ws_1",
      role: "member",
    });
    // Simulate stream returning more bytes than MAX_INGEST_BYTES
    mockStreamUploadToS3.mockResolvedValue({ sizeBytes: 600 * 1024 * 1024 });

    const mockBody = new ReadableStream({
      start(controller) {
        controller.close();
      },
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ "content-type": "image/png" }),
      body: mockBody,
    });

    try {
      const response = await POST(
        createRequest({
          assetType: "image",
          sourceUrl: "https://example.com/huge-file.png",
        }),
      );

      expect(response.status).toBe(413);
      expect(mockDeleteObjectFromS3).toHaveBeenCalled();
      expect(mockFinalizeAssetUpload).toHaveBeenCalledWith(
        expect.objectContaining({ uploadState: "failed" }),
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
