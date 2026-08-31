import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mockIsDatabaseConfigured = vi.fn(() => true);
const mockListObjectsInS3 = vi.fn();
const mockCopyObjectInS3 = vi.fn();
const mockDeleteObjectFromS3 = vi.fn();
const mockBuildAssetObjectKey = vi.fn();
const mockRecordAsset = vi.fn();

vi.mock("@/lib/db", () => ({
  isDatabaseConfigured: (...args: unknown[]) => mockIsDatabaseConfigured(...(args as [])),
}));

vi.mock("@/lib/storage", () => ({
  listObjectsInS3: (...args: unknown[]) => mockListObjectsInS3(...args),
  copyObjectInS3: (...args: unknown[]) => mockCopyObjectInS3(...args),
  deleteObjectFromS3: (...args: unknown[]) => mockDeleteObjectFromS3(...args),
  buildAssetObjectKey: (...args: unknown[]) => mockBuildAssetObjectKey(...args),
}));

vi.mock("@/lib/studio/repository", () => ({
  recordAsset: (...args: unknown[]) => mockRecordAsset(...args),
}));

function createRequest(
  url = "http://localhost:3000/api/studio/internal/migrate-legacy-assets?workspaceId=ws_1",
): NextRequest {
  return new NextRequest(url, {
    method: "POST",
    headers: {
      "x-studio-internal-secret": "secret_123",
    },
  });
}

describe("/api/studio/internal/migrate-legacy-assets POST", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsDatabaseConfigured.mockReturnValue(true);
    process.env.STUDIO_INTERNAL_API_SECRET = "secret_123";
    mockBuildAssetObjectKey.mockReturnValue("env/dev/ws/ws_1/image/new-key.png");
    mockCopyObjectInS3.mockResolvedValue(undefined);
    mockDeleteObjectFromS3.mockResolvedValue(undefined);
    mockRecordAsset.mockResolvedValue({ id: "asset_1" });
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
      "http://localhost:3000/api/studio/internal/migrate-legacy-assets?workspaceId=ws_1",
      { method: "POST" },
    );

    const response = await POST(request);
    expect(response.status).toBe(401);
  });

  it("returns 400 when workspaceId is missing", async () => {
    const { POST } = await import("../route");
    const response = await POST(
      createRequest("http://localhost:3000/api/studio/internal/migrate-legacy-assets"),
    );
    expect(response.status).toBe(400);
  });

  it("migrates legacy assets to new key format", async () => {
    mockListObjectsInS3.mockResolvedValue({
      keys: ["workflows/my-project/inputs/photo.png", "workflows/my-project/generations/out.jpg"],
    });

    const { POST } = await import("../route");
    const response = await POST(createRequest());
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.summary).toEqual({
      scanned: 2,
      migrated: 2,
      errors: 0,
    });
    expect(mockCopyObjectInS3).toHaveBeenCalledTimes(2);
    expect(mockRecordAsset).toHaveBeenCalledTimes(2);
    expect(mockDeleteObjectFromS3).not.toHaveBeenCalled();
  });

  it("deletes originals when deleteOriginal=true", async () => {
    mockListObjectsInS3.mockResolvedValue({
      keys: ["workflows/proj/inputs/photo.png"],
    });

    const { POST } = await import("../route");
    const response = await POST(
      createRequest(
        "http://localhost:3000/api/studio/internal/migrate-legacy-assets?workspaceId=ws_1&deleteOriginal=true",
      ),
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.summary.migrated).toBe(1);
    expect(mockDeleteObjectFromS3).toHaveBeenCalledWith({
      key: "workflows/proj/inputs/photo.png",
    });
  });

  it("returns empty summary when no legacy assets exist", async () => {
    mockListObjectsInS3.mockResolvedValue({ keys: [] });

    const { POST } = await import("../route");
    const response = await POST(createRequest());
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.summary).toEqual({
      scanned: 0,
      migrated: 0,
      errors: 0,
    });
  });

  it("continues when individual migration fails", async () => {
    mockListObjectsInS3.mockResolvedValue({
      keys: ["workflows/proj/inputs/good.png", "workflows/proj/inputs/bad.png"],
    });
    mockCopyObjectInS3
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("copy failed"));

    const { POST } = await import("../route");
    const response = await POST(createRequest());
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.summary.migrated).toBe(1);
    expect(data.summary.errors).toBe(1);
  });

  it("passes continuation token for pagination", async () => {
    mockListObjectsInS3.mockResolvedValue({
      keys: ["workflows/proj/inputs/photo.png"],
      nextContinuationToken: "token_abc",
    });

    const { POST } = await import("../route");
    const response = await POST(createRequest());
    const data = await response.json();

    expect(data.summary.nextContinuationToken).toBe("token_abc");
  });

  it("returns only the allowlisted failure contract for raw backend errors", async () => {
    const canary = "prompt api_key Authorization Cookie X-Amz-Signature providerBody";
    mockListObjectsInS3.mockRejectedValue(new Error(canary));
    const { POST } = await import("../route");

    const response = await POST(createRequest());
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(data).toEqual({
      success: false,
      code: "LEGACY_ASSET_MIGRATION_UNAVAILABLE",
      error: "Legacy-asset migration is temporarily unavailable.",
    });
    expect(JSON.stringify(data)).not.toContain(canary);
  });
});
