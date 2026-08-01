import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mockIsDatabaseConfigured = vi.fn(() => true);
const mockListPurgeableSoftDeletedAssets = vi.fn();
const mockHardDeleteAsset = vi.fn();
const mockDeleteObjectFromS3 = vi.fn();

vi.mock("@/lib/db", () => ({
  isDatabaseConfigured: (...args: unknown[]) => mockIsDatabaseConfigured(...(args as [])),
}));

vi.mock("@/lib/studio/repository", () => ({
  listPurgeableSoftDeletedAssets: (...args: unknown[]) =>
    mockListPurgeableSoftDeletedAssets(...args),
  hardDeleteAsset: (...args: unknown[]) => mockHardDeleteAsset(...args),
}));

vi.mock("@/lib/storage", () => ({
  deleteObjectFromS3: (...args: unknown[]) => mockDeleteObjectFromS3(...args),
}));

function createRequest(
  url = "http://localhost:3000/api/studio/internal/purge-deleted",
): NextRequest {
  return new NextRequest(url, {
    method: "POST",
    headers: {
      "x-studio-internal-secret": "secret_123",
    },
  });
}

describe("/api/studio/internal/purge-deleted POST", () => {
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
      "http://localhost:3000/api/studio/internal/purge-deleted",
      { method: "POST" },
    );

    const response = await POST(request);
    expect(response.status).toBe(401);
  });

  it("purges soft-deleted assets past retention period", async () => {
    mockListPurgeableSoftDeletedAssets.mockResolvedValue([
      { id: "asset_1", workspaceId: "ws_1", storageProvider: "s3", storageKey: "key/1.png", sizeBytes: "1024" },
      { id: "asset_2", workspaceId: "ws_2", storageProvider: "s3", storageKey: "key/2.png", sizeBytes: "2048" },
    ]);
    mockDeleteObjectFromS3.mockResolvedValue(undefined);
    mockHardDeleteAsset.mockResolvedValue(true);

    const { POST } = await import("../route");
    const response = await POST(createRequest());
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.summary).toEqual({
      scanned: 2,
      purgedRecords: 2,
      deletedObjects: 2,
      errors: 0,
    });
    expect(mockDeleteObjectFromS3).toHaveBeenCalledTimes(2);
    expect(mockHardDeleteAsset).toHaveBeenCalledTimes(2);
  });

  it("skips DB delete when R2 delete fails", async () => {
    mockListPurgeableSoftDeletedAssets.mockResolvedValue([
      { id: "asset_1", workspaceId: "ws_1", storageProvider: "s3", storageKey: "key/1.png", sizeBytes: "1024" },
    ]);
    mockDeleteObjectFromS3.mockRejectedValue(new Error("R2 error"));

    const { POST } = await import("../route");
    const response = await POST(createRequest());
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.summary.errors).toBe(1);
    expect(data.summary.purgedRecords).toBe(0);
    expect(mockHardDeleteAsset).not.toHaveBeenCalled();
  });

  it("returns empty summary when no purgeable assets exist", async () => {
    mockListPurgeableSoftDeletedAssets.mockResolvedValue([]);

    const { POST } = await import("../route");
    const response = await POST(createRequest());
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.summary).toEqual({
      scanned: 0,
      purgedRecords: 0,
      deletedObjects: 0,
      errors: 0,
    });
  });

  it("respects retentionDays and limit query parameters", async () => {
    mockListPurgeableSoftDeletedAssets.mockResolvedValue([]);

    const { POST } = await import("../route");
    const response = await POST(
      createRequest("http://localhost:3000/api/studio/internal/purge-deleted?retentionDays=60&limit=25"),
    );

    expect(response.status).toBe(200);
    expect(mockListPurgeableSoftDeletedAssets).toHaveBeenCalledWith({
      retentionDays: 60,
      limit: 25,
    });
  });

  it("uses default retention of 30 days", async () => {
    mockListPurgeableSoftDeletedAssets.mockResolvedValue([]);

    const { POST } = await import("../route");
    await POST(createRequest());

    expect(mockListPurgeableSoftDeletedAssets).toHaveBeenCalledWith({
      retentionDays: 30,
      limit: 100,
    });
  });

  it("returns only the allowlisted failure contract for raw backend errors", async () => {
    const canary = "prompt api_key Authorization Cookie X-Amz-Signature providerBody";
    mockListPurgeableSoftDeletedAssets.mockRejectedValue(new Error(canary));
    const { POST } = await import("../route");

    const response = await POST(createRequest());
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(data).toEqual({
      success: false,
      code: "PURGE_DELETED_UNAVAILABLE",
      error: "Deleted-asset purge is temporarily unavailable.",
    });
    expect(JSON.stringify(data)).not.toContain(canary);
  });
});
