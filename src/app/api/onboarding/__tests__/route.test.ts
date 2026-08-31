import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getServerAuthSession: vi.fn(),
  getSnapshot: vi.fn(),
  execute: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ isDatabaseConfigured: () => true }));
vi.mock("@/lib/auth/session", () => ({
  getServerAuthSession: mocks.getServerAuthSession,
  getDevFallbackUserId: () => "dev_user",
  isDevAuthBypassEnabled: () => false,
  parseHeaderValue: (value: string | null | undefined) => value?.trim() || null,
}));
vi.mock("@/lib/onboarding/production", () => ({
  createProductionOnboardingService: () => ({
    getSnapshot: mocks.getSnapshot,
    execute: mocks.execute,
  }),
}));

import { GET, POST } from "../route";

function session(emailVerified: boolean) {
  return {
    session: { id: "session_1" },
    user: { id: "user_1", emailVerified },
  };
}

function request(method: "GET" | "POST", body?: unknown, includeOrigin = true) {
  return new NextRequest("https://app.example.com/api/onboarding", {
    method,
    headers: includeOrigin
      ? { origin: "https://app.example.com", "content-type": "application/json" }
      : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("/api/onboarding", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("requires a signed-in and verified user", async () => {
    mocks.getServerAuthSession.mockResolvedValueOnce(null);
    expect((await GET(request("GET"))).status).toBe(401);

    mocks.getServerAuthSession.mockResolvedValueOnce(session(false));
    const response = await GET(request("GET"));
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      code: "EMAIL_VERIFICATION_REQUIRED",
    });
  });

  it("returns only the authenticated user's server snapshot", async () => {
    mocks.getServerAuthSession.mockResolvedValue(session(true));
    mocks.getSnapshot.mockResolvedValue({ sessionId: "onb_1", userId: "user_1" });

    const response = await GET(request("GET"));
    expect(response.status).toBe(200);
    expect(mocks.getSnapshot).toHaveBeenCalledWith({ userId: "user_1" });
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      snapshot: { sessionId: "onb_1" },
    });
  });

  it("requires same-origin mutations and never accepts a browser workspace ID", async () => {
    mocks.getServerAuthSession.mockResolvedValue(session(true));
    const command = {
      type: "save_identity",
      expectedRevision: 0,
      idempotencyKey: "identity_123",
      payload: { fullName: "Noura", companyName: "Tasmeem", logoAssetId: null },
    };

    expect((await POST(request("POST", command, false))).status).toBe(403);

    mocks.execute.mockResolvedValue({ revision: 1 });
    const response = await POST(request("POST", command));
    expect(response.status).toBe(200);
    expect(mocks.execute).toHaveBeenCalledWith({ userId: "user_1", command });
  });
});
