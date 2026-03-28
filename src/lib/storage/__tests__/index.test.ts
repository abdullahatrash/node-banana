import { describe, it, expect, beforeEach, vi } from "vitest";

describe("isCloudMode", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns true when STORAGE_BACKEND is s3 and S3 is configured", () => {
    vi.stubEnv("STORAGE_BACKEND", "s3");
    vi.stubEnv("S3_BUCKET_NAME", "test-bucket");
    vi.stubEnv("S3_REGION", "auto");
    vi.stubEnv("S3_ACCESS_KEY_ID", "key");
    vi.stubEnv("S3_SECRET_ACCESS_KEY", "secret");

    return import("../index").then(({ isCloudMode }) => {
      expect(isCloudMode()).toBe(true);
    });
  });

  it("returns false when STORAGE_BACKEND is local", () => {
    vi.stubEnv("STORAGE_BACKEND", "local");

    return import("../index").then(({ isCloudMode }) => {
      expect(isCloudMode()).toBe(false);
    });
  });

  it("returns false when STORAGE_BACKEND is s3 but S3 vars missing", () => {
    vi.stubEnv("STORAGE_BACKEND", "s3");
    delete process.env.S3_BUCKET_NAME;

    return import("../index").then(({ isCloudMode }) => {
      expect(isCloudMode()).toBe(false);
    });
  });
});
