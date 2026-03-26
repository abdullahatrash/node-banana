import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mockCleanupStates = vi.fn();
const mockCleanupSelectionSessions = vi.fn();

vi.mock("@/lib/db", () => ({
  isDatabaseConfigured: vi.fn(() => true),
}));

vi.mock("@/lib/social/repository", () => ({
  cleanupExpiredOAuthStates: (...args: unknown[]) => mockCleanupStates(...args),
  cleanupExpiredOAuthSelectionSessions: (...args: unknown[]) =>
    mockCleanupSelectionSessions(...args),
}));

function createRequest(headers?: Record<string, string>): NextRequest {
  return new NextRequest("http://localhost:3000/api/social/internal/cleanup", {
    method: "POST",
    headers,
  });
}

describe("/api/social/internal/cleanup POST", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SOCIAL_INTERNAL_API_SECRET = "secret_123";
  });

  it("returns 401 for missing auth secret", async () => {
    const { POST } = await import("../route");
    const response = await POST(createRequest());
    expect(response.status).toBe(401);
  });

  it("returns 401 for invalid auth secret", async () => {
    const { POST } = await import("../route");
    const response = await POST(
      createRequest({ "x-social-internal-secret": "wrong_secret" }),
    );
    expect(response.status).toBe(401);
  });

  it("cleans expired OAuth state/session rows", async () => {
    mockCleanupStates.mockResolvedValue(3);
    mockCleanupSelectionSessions.mockResolvedValue(2);

    const { POST } = await import("../route");
    const response = await POST(
      createRequest({ "x-social-internal-secret": "secret_123" }),
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.cleaned).toEqual({ oauthStates: 3, selectionSessions: 2 });
    expect(mockCleanupStates).toHaveBeenCalledTimes(1);
    expect(mockCleanupSelectionSessions).toHaveBeenCalledTimes(1);
  });

  it("accepts bearer authorization header", async () => {
    mockCleanupStates.mockResolvedValue(1);
    mockCleanupSelectionSessions.mockResolvedValue(1);

    const { POST } = await import("../route");
    const response = await POST(
      createRequest({ authorization: "Bearer secret_123" }),
    );

    expect(response.status).toBe(200);
  });

  it("returns 503 when internal secret is not configured", async () => {
    process.env.SOCIAL_INTERNAL_API_SECRET = "";

    const { POST } = await import("../route");
    const response = await POST(
      createRequest({ "x-social-internal-secret": "secret_123" }),
    );
    expect(response.status).toBe(503);
  });
});
