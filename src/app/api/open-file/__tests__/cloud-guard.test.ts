import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

describe("open-file cloud guard", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns 501 when in cloud mode", async () => {
    // Set env vars to trigger isCloudMode() = true
    vi.stubEnv("STORAGE_BACKEND", "s3");
    vi.stubEnv("S3_BUCKET_NAME", "test-bucket");
    vi.stubEnv("S3_REGION", "auto");
    vi.stubEnv("S3_ACCESS_KEY_ID", "key");
    vi.stubEnv("S3_SECRET_ACCESS_KEY", "secret");

    // Re-import the route to get fresh module with new env
    vi.resetModules();
    const { POST } = await import("../route");

    const req = new NextRequest("http://localhost:3000/api/open-file", {
      method: "POST",
      body: JSON.stringify({ filePath: "/home/test/file.txt" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req);
    expect(res.status).toBe(501);
    const json = await res.json();
    expect(json.error).toContain("local");
  });
});
