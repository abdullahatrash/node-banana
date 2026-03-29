import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "../route";

function createRequest(body: unknown): NextRequest {
  return {
    headers: new Headers(),
    json: async () => body,
  } as unknown as NextRequest;
}

describe("/api/load-generation cloud guard", () => {
  it("returns 501 in cloud mode", async () => {
    vi.stubEnv("STORAGE_BACKEND", "s3");
    vi.stubEnv("S3_BUCKET_NAME", "test-bucket");
    vi.stubEnv("S3_REGION", "auto");
    vi.stubEnv("S3_ACCESS_KEY_ID", "key");
    vi.stubEnv("S3_SECRET_ACCESS_KEY", "secret");

    const response = await POST(
      createRequest({
        directoryPath: "/tmp/generations",
        imageId: "abc",
      }),
    );
    const data = await response.json();
    expect(response.status).toBe(501);
    expect(data.success).toBe(false);
  });
});
