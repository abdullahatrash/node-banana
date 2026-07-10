import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ContentOSSession } from "@/lib/studio/authz";
import { getPermissionsForRole } from "@/lib/studio/authz";

const {
  mockGetProject,
  mockRecordPending,
  mockFinalizeAssetUpload,
  mockBuildAssetObjectKey,
  mockPutObjectToS3,
  mockStreamUploadToS3,
  mockDeleteObjectFromS3,
  mockCreatePresignedDownload,
  mockBuildCdnDownloadUrl,
  mockCanUseS3Storage,
  mockFetch,
} = vi.hoisted(() => ({
  mockGetProject: vi.fn(),
  mockRecordPending: vi.fn(),
  mockFinalizeAssetUpload: vi.fn(),
  mockBuildAssetObjectKey: vi.fn(),
  mockPutObjectToS3: vi.fn(),
  mockStreamUploadToS3: vi.fn(),
  mockDeleteObjectFromS3: vi.fn(),
  mockCreatePresignedDownload: vi.fn(),
  mockBuildCdnDownloadUrl: vi.fn(),
  mockCanUseS3Storage: vi.fn(() => true),
  mockFetch: vi.fn(),
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

vi.mock("@/lib/storage", () => ({
  canUseS3Storage: (...args: unknown[]) => mockCanUseS3Storage(...args),
  buildAssetObjectKey: (...args: unknown[]) => mockBuildAssetObjectKey(...args),
  buildCdnDownloadUrl: (...args: unknown[]) => mockBuildCdnDownloadUrl(...args),
  createPresignedDownload: (...args: unknown[]) => mockCreatePresignedDownload(...args),
  putObjectToS3: (...args: unknown[]) => mockPutObjectToS3(...args),
  streamUploadToS3: (...args: unknown[]) => mockStreamUploadToS3(...args),
  deleteObjectFromS3: (...args: unknown[]) => mockDeleteObjectFromS3(...args),
}));

vi.mock("@/lib/studio/repository", () => ({
  getProject: (...args: unknown[]) => mockGetProject(...args),
  recordPendingS3AssetWithQuota: (...args: unknown[]) => mockRecordPending(...args),
  finalizeAssetUpload: (...args: unknown[]) => mockFinalizeAssetUpload(...args),
  StudioAssetQuotaExceededError: MockStudioAssetQuotaExceededError,
}));

import { runTool } from "../../runtime";
import { uploadAssetTool } from "../upload-asset";

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

beforeEach(() => {
  vi.clearAllMocks();
  mockCanUseS3Storage.mockReturnValue(true);
  mockBuildAssetObjectKey.mockReturnValue("workspace/ws_1/unscoped/image/file.png");
  mockRecordPending.mockResolvedValue({ id: "asset_new" });
  mockFinalizeAssetUpload.mockResolvedValue({ id: "asset_new" });
  mockBuildCdnDownloadUrl.mockReturnValue(null);
  mockCreatePresignedDownload.mockResolvedValue({
    key: "workspace/ws_1/unscoped/image/file.png",
    downloadUrl: "https://signed.example/file.png",
    expiresInSeconds: 900,
  });
  vi.stubGlobal("fetch", mockFetch);
});

describe("upload_asset tool", () => {
  it("uploads base64 content and returns an asset id + presigned url", async () => {
    const base64 = Buffer.from("hello world").toString("base64");

    const result = await runTool(
      uploadAssetTool,
      {
        assetType: "image",
        fileName: "photo.png",
        mimeType: "image/png",
        base64Content: base64,
      },
      { session: session("owner", "ws_1") },
    );

    expect(mockRecordPending).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "ws_1",
        type: "image",
        mimeType: "image/png",
        expectedSizeBytes: Buffer.from("hello world").length,
      }),
    );
    expect(mockPutObjectToS3).toHaveBeenCalledWith(
      expect.objectContaining({ contentType: "image/png" }),
    );
    expect(mockFinalizeAssetUpload).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "ws_1",
        assetId: "asset_new",
        uploadState: "ready",
      }),
    );
    expect(result).toEqual({
      assetId: "asset_new",
      downloadUrl: "https://signed.example/file.png",
      expiresInSeconds: 900,
    });
  });

  it("prefers a CDN url over a presigned url when configured", async () => {
    mockBuildCdnDownloadUrl.mockReturnValue("https://cdn.example/file.png");
    const base64 = Buffer.from("hello").toString("base64");

    const result = await runTool(
      uploadAssetTool,
      { assetType: "image", base64Content: base64 },
      { session: session("owner", "ws_1") },
    );

    expect(result.downloadUrl).toBe("https://cdn.example/file.png");
    expect(result.expiresInSeconds ?? null).toBeNull();
    expect(mockCreatePresignedDownload).not.toHaveBeenCalled();
  });

  it("uploads from a sourceUrl by streaming it to storage", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3]));
        controller.close();
      },
    });
    mockFetch.mockResolvedValue(
      new Response(body, {
        status: 200,
        headers: { "content-type": "image/jpeg", "content-length": "3" },
      }),
    );
    mockStreamUploadToS3.mockResolvedValue({ sizeBytes: 3 });

    const result = await runTool(
      uploadAssetTool,
      { assetType: "image", sourceUrl: "https://example.com/pic.jpg" },
      { session: session("owner", "ws_1") },
    );

    expect(mockFetch).toHaveBeenCalledWith(
      "https://example.com/pic.jpg",
      expect.objectContaining({ signal: expect.anything() }),
    );
    expect(mockStreamUploadToS3).toHaveBeenCalled();
    expect(mockFinalizeAssetUpload).toHaveBeenCalledWith(
      expect.objectContaining({ uploadState: "ready", sizeBytes: 3 }),
    );
    expect(result.assetId).toBe("asset_new");
  });

  it("rejects when neither base64Content nor sourceUrl is provided", async () => {
    const error = await runTool(
      uploadAssetTool,
      { assetType: "image" },
      { session: session("owner", "ws_1") },
    ).catch((e) => e);

    expect(error.code).toBe("invalid_input");
    expect(mockRecordPending).not.toHaveBeenCalled();
  });

  it("rejects when both base64Content and sourceUrl are provided", async () => {
    const error = await runTool(
      uploadAssetTool,
      {
        assetType: "image",
        base64Content: Buffer.from("x").toString("base64"),
        sourceUrl: "https://example.com/a.png",
      },
      { session: session("owner", "ws_1") },
    ).catch((e) => e);

    expect(error.code).toBe("invalid_input");
    expect(mockRecordPending).not.toHaveBeenCalled();
  });

  it("rejects an unsupported asset type before touching storage", async () => {
    const error = await runTool(
      uploadAssetTool,
      { assetType: "bogus", base64Content: Buffer.from("x").toString("base64") },
      { session: session("owner", "ws_1") },
    ).catch((e) => e);

    expect(error.code).toBe("invalid_input");
    expect(mockRecordPending).not.toHaveBeenCalled();
  });

  it("rejects content over the size limit", async () => {
    // Just over the 50MB base64Content cap (kept well under 500MB so the
    // base64-inflated string stays far from V8's string-length ceiling).
    const huge = Buffer.alloc(51 * 1024 * 1024, 1).toString("base64");

    const error = await runTool(
      uploadAssetTool,
      { assetType: "video", base64Content: huge },
      { session: session("owner", "ws_1") },
    ).catch((e) => e);

    expect(error.code).toBe("invalid_input");
    expect(mockRecordPending).not.toHaveBeenCalled();
  });

  it("surfaces a workspace quota breach as a forbidden tool error", async () => {
    mockRecordPending.mockRejectedValue(new MockStudioAssetQuotaExceededError());

    const error = await runTool(
      uploadAssetTool,
      { assetType: "image", base64Content: Buffer.from("hi").toString("base64") },
      { session: session("owner", "ws_1") },
    ).catch((e) => e);

    expect(error.code).toBe("forbidden");
    expect(mockPutObjectToS3).not.toHaveBeenCalled();
  });

  it("rejects a projectId the workspace cannot access", async () => {
    mockGetProject.mockResolvedValue(null);

    const error = await runTool(
      uploadAssetTool,
      {
        assetType: "image",
        projectId: "proj_other",
        base64Content: Buffer.from("hi").toString("base64"),
      },
      { session: session("owner", "ws_1") },
    ).catch((e) => e);

    expect(error.code).toBe("not_found");
    expect(mockRecordPending).not.toHaveBeenCalled();
  });

  it("denies callers whose role lacks assets:write", async () => {
    const memberSession = session("member");
    memberSession.permissions = memberSession.permissions.filter(
      (p) => p !== "assets:write",
    );

    const error = await runTool(
      uploadAssetTool,
      { assetType: "image", base64Content: Buffer.from("hi").toString("base64") },
      { session: memberSession },
    ).catch((e) => e);

    expect(error.code).toBe("forbidden");
    expect(mockRecordPending).not.toHaveBeenCalled();
  });
});
