import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { ensureInternalStudioAuth } from "@/lib/studio/internal-auth";

function request(headers?: Record<string, string>): NextRequest {
  return new NextRequest("http://localhost:3000/api/studio/internal/test", {
    method: "POST",
    headers,
  });
}

describe("studio/internal-auth", () => {
  beforeEach(() => {
    delete process.env.STUDIO_INTERNAL_API_SECRET;
  });

  it("accepts the shared secret from the dedicated header", () => {
    process.env.STUDIO_INTERNAL_API_SECRET = "secret_123";

    const response = ensureInternalStudioAuth(
      request({ "x-studio-internal-secret": " secret_123 " }),
    );

    expect(response).toBeNull();
  });

  it("accepts bearer authorization as a fallback", () => {
    process.env.STUDIO_INTERNAL_API_SECRET = "secret_123";

    const response = ensureInternalStudioAuth(
      request({ authorization: "Bearer secret_123" }),
    );

    expect(response).toBeNull();
  });

  it("rejects missing or mismatched secrets", () => {
    process.env.STUDIO_INTERNAL_API_SECRET = "secret_123";

    const response = ensureInternalStudioAuth(
      request({ "x-studio-internal-secret": "wrong_secret" }),
    );

    expect(response?.status).toBe(401);
  });

  it("rejects when no secret is provided", () => {
    process.env.STUDIO_INTERNAL_API_SECRET = "secret_123";

    const response = ensureInternalStudioAuth(request());

    expect(response?.status).toBe(401);
  });

  it("returns 503 when the secret is not configured", () => {
    const response = ensureInternalStudioAuth(request());

    expect(response?.status).toBe(503);
  });
});
