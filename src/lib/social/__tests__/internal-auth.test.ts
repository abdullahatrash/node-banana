import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { ensureInternalSocialAuth } from "@/lib/social/internal-auth";

function request(headers?: Record<string, string>): NextRequest {
  return new NextRequest("http://localhost:3000/api/social/internal/test", {
    method: "POST",
    headers,
  });
}

describe("social/internal-auth", () => {
  beforeEach(() => {
    delete process.env.SOCIAL_INTERNAL_API_SECRET;
  });

  it("accepts the shared secret from the dedicated header", () => {
    process.env.SOCIAL_INTERNAL_API_SECRET = "secret_123";

    const response = ensureInternalSocialAuth(
      request({ "x-social-internal-secret": " secret_123 " }),
    );

    expect(response).toBeNull();
  });

  it("accepts bearer authorization as a fallback", () => {
    process.env.SOCIAL_INTERNAL_API_SECRET = "secret_123";

    const response = ensureInternalSocialAuth(
      request({ authorization: "Bearer secret_123" }),
    );

    expect(response).toBeNull();
  });

  it("rejects missing or mismatched secrets", () => {
    process.env.SOCIAL_INTERNAL_API_SECRET = "secret_123";

    const response = ensureInternalSocialAuth(
      request({ "x-social-internal-secret": "wrong_secret" }),
    );

    expect(response?.status).toBe(401);
  });

  it("returns 503 when the secret is not configured", () => {
    const response = ensureInternalSocialAuth(request());

    expect(response?.status).toBe(503);
  });
});
