import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mockIsDatabaseConfigured = vi.fn(() => true);
const mockListExpiredPendingAssets = vi.fn();
const mockFinalizeAssetUpload = vi.fn();
const mockDeleteObjectFromS3 = vi.fn();

vi.mock("@/lib/db", () => ({
  isDatabaseConfigured: (...args: unknown[]) => mockIsDatabaseConfigured(...(args as [])),
}));

vi.mock("@/lib/studio/repository", () => ({
  listExpiredPendingAssets: (...args: unknown[]) =>
    mockListExpiredPendingAssets(...args),
  finalizeAssetUpload: (...args: unknown[]) => mockFinalizeAssetUpload(...args),
}));

vi.mock("@/lib/storage", () => ({
  deleteObjectFromS3: (...args: unknown[]) => mockDeleteObjectFromS3(...args),
}));

function createRequest(
  url = "http://localhost:3000/api/studio/internal/orphan-cleanup",
): NextRequest {
  return new NextRequest(url, {
    method: "POST",
    headers: {
      "x-studio-internal-secret": "secret_123",
    },
  });
}

describe("/api/studio/internal/orphan-cleanup POST", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsDatabaseConfigured.mockReturnValue(true);
    process.env.STUDIO_INTERNAL_API_SECRET = "secret_123";
  });

  it("returns 503 when database is not configured", async () => {
    mockIsDatabaseConfigured.mockReturnValue(false);
    const { POST } = await import("../route");

    const response = await POST(createRequest());
    expect(response.status).toBe(503);
  });

  it("returns 401 for unauthorized request", async () => {
    const { POST } = await import("../route");
    const request = new NextRequest(
      "http://localhost:3000/api/studio/internal/orphan-cleanup",
      { method: "POST" },
    );

    const response = await POST(request);
    expect(response.status).toBe(401);
  });

  it("returns 503 when STUDIO_INTERNAL_API_SECRET is not configured", async () => {
    delete process.env.STUDIO_INTERNAL_API_SECRET;
    const { POST } = await import("../route");

    const response = await POST(createRequest());
    expect(response.status).toBe(503);
  });

  it("processes expired pending assets", async () => {
    mockListExpiredPendingAssets.mockResolvedValue([
      { id: "asset_1", workspaceId: "ws_1", storageKey: "key/1.png" },
      { id: "asset_2", workspaceId: "ws_2", storageKey: "key/2.png" },
    ]);
    mockDeleteObjectFromS3.mockResolvedValue(undefined);
    mockFinalizeAssetUpload.mockResolvedValue({});

    const { POST } = await import("../route");
    const response = await POST(createRequest());
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.summary).toEqual({
      scanned: 2,
      failedAssets: 2,
      deletedObjects: 2,
      errors: 0,
    });
    expect(mockDeleteObjectFromS3).toHaveBeenCalledTimes(2);
    expect(mockFinalizeAssetUpload).toHaveBeenCalledWith(
      expect.objectContaining({
        assetId: "asset_1",
        uploadState: "failed",
      }),
    );
  });

  it("continues when individual R2 delete fails", async () => {
    mockListExpiredPendingAssets.mockResolvedValue([
      { id: "asset_1", workspaceId: "ws_1", storageKey: "key/1.png" },
    ]);
    mockDeleteObjectFromS3.mockRejectedValue(new Error("R2 error"));
    mockFinalizeAssetUpload.mockResolvedValue({});

    const { POST } = await import("../route");
    const response = await POST(createRequest());
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.summary.errors).toBe(1);
    expect(data.summary.failedAssets).toBe(1);
    expect(mockFinalizeAssetUpload).toHaveBeenCalled();
  });

  it("returns empty summary when no expired assets exist", async () => {
    mockListExpiredPendingAssets.mockResolvedValue([]);

    const { POST } = await import("../route");
    const response = await POST(createRequest());
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.summary).toEqual({
      scanned: 0,
      failedAssets: 0,
      deletedObjects: 0,
      errors: 0,
    });
  });

  it("respects the limit query parameter", async () => {
    mockListExpiredPendingAssets.mockResolvedValue([]);

    const { POST } = await import("../route");
    const response = await POST(
      createRequest("http://localhost:3000/api/studio/internal/orphan-cleanup?limit=10"),
    );

    expect(response.status).toBe(200);
    expect(mockListExpiredPendingAssets).toHaveBeenCalledWith({ limit: 10 });
  });

  it("skips R2 delete when deleteObjects=false", async () => {
    mockListExpiredPendingAssets.mockResolvedValue([
      { id: "asset_1", workspaceId: "ws_1", storageKey: "key/1.png" },
    ]);
    mockFinalizeAssetUpload.mockResolvedValue({});

    const { POST } = await import("../route");
    const response = await POST(
      createRequest("http://localhost:3000/api/studio/internal/orphan-cleanup?deleteObjects=false"),
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(mockDeleteObjectFromS3).not.toHaveBeenCalled();
    expect(data.summary.failedAssets).toBe(1);
  });
});
