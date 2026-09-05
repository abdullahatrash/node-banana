import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getServerAuthSession: vi.fn(),
  getSnapshot: vi.fn(),
  execute: vi.fn(),
  claimReferralCapture: vi.fn(),
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
vi.mock("@/lib/commercial/production", () => ({
  COMMERCIAL: { claimReferralCapture: mocks.claimReferralCapture },
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

  it("claims a referral only after verified onboarding completes and clears the opaque cookie", async () => {
    mocks.getServerAuthSession.mockResolvedValue(session(true));
    mocks.execute.mockResolvedValue({
      sessionId: "onb_1",
      userId: "user_1",
      workspaceId: "workspace_1",
      status: "completed",
    });
    mocks.claimReferralCapture.mockResolvedValue({ kind: "attributed", attributionId: "attr_1" });
    const command = {
      type: "complete",
      expectedRevision: 8,
      idempotencyKey: "complete_123",
      payload: {},
    };
    const referralToken = "r".repeat(43);
    const response = await POST(new NextRequest("https://app.example.com/api/onboarding", {
      method: "POST",
      headers: {
        origin: "https://app.example.com",
        "content-type": "application/json",
        cookie: `node-banana-referral-capture=${referralToken}`,
      },
      body: JSON.stringify(command),
    }));

    expect(response.status).toBe(200);
    expect(mocks.execute).toHaveBeenCalledBefore(mocks.claimReferralCapture);
    expect(mocks.claimReferralCapture).toHaveBeenCalledWith({
      token: referralToken,
      userId: "user_1",
      referredWorkspaceId: "workspace_1",
    });
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
  });

  it("does not let referral infrastructure roll back completed onboarding", async () => {
    mocks.getServerAuthSession.mockResolvedValue(session(true));
    mocks.execute.mockResolvedValue({ workspaceId: "workspace_1", status: "completed" });
    mocks.claimReferralCapture.mockRejectedValue(new Error("database temporarily unavailable"));
    const response = await POST(new NextRequest("https://app.example.com/api/onboarding", {
      method: "POST",
      headers: {
        origin: "https://app.example.com",
        "content-type": "application/json",
        cookie: `node-banana-referral-capture=${"r".repeat(43)}`,
      },
      body: JSON.stringify({ type: "complete", expectedRevision: 8, idempotencyKey: "complete_456", payload: {} }),
    }));

    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toBeNull();
  });
});
