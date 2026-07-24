import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildAssetObjectKey, createPresignedUpload } from "../s3";

describe("buildAssetObjectKey", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  it("builds canonical env/workspace/project/type/date key layout", () => {
    vi.stubEnv("STORAGE_ENV", "production");

    const key = buildAssetObjectKey({
      workspaceId: "ws_123",
      projectId: "proj_456",
      assetType: "image",
      fileExtension: "png",
    });

    expect(key).toMatch(
      /^env\/production\/ws\/ws_123\/proj\/proj_456\/image\/\d{4}\/\d{2}\/\d{2}\/\d+-[a-f0-9-]+\.png$/,
    );
  });

  it("sanitizes unsafe segments and never allows nested path injection", () => {
    vi.stubEnv("STORAGE_ENV", "Prod/../Unsafe");

    const key = buildAssetObjectKey({
      workspaceId: "WS/../../A",
      projectId: "proj//nested",
      assetType: "image/raw",
      fileExtension: ".pn/g",
    });

    expect(key).toContain("env/prod_unsafe/ws/ws_a/proj/proj_nested/image_raw/");
    expect(key).not.toContain("..");
    expect(key).not.toContain("//");
  });

  it("uses unscoped project fallback when projectId is null", () => {
    const key = buildAssetObjectKey({
      workspaceId: "ws_1",
      projectId: null,
      assetType: "audio",
      fileExtension: "mp3",
    });

    expect(key).toContain("/proj/unscoped/audio/");
    expect(key.endsWith(".mp3")).toBe(true);
  });

  it("presigns an exact-length non-empty upload without an empty checksum", async () => {
    vi.stubEnv("S3_BUCKET_NAME", "test-bucket");
    vi.stubEnv("S3_REGION", "us-east-1");
    vi.stubEnv("S3_ACCESS_KEY_ID", "test-access-key");
    vi.stubEnv("S3_SECRET_ACCESS_KEY", "test-secret-key");

    const signed = await createPresignedUpload({
      key: "agent-artifacts/staging/test/upload",
      contentType: "image/png",
      contentLength: 123,
      expiresInSeconds: 300,
    });
    const url = new URL(signed.uploadUrl);

    expect(url.searchParams.get("X-Amz-SignedHeaders")?.split(";")).toContain(
      "content-length",
    );
    expect(url.searchParams.has("x-amz-checksum-crc32")).toBe(false);
    expect(url.searchParams.has("x-amz-sdk-checksum-algorithm")).toBe(false);
  });
});
