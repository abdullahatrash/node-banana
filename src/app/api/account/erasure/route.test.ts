import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getServerAuthSession: vi.fn(),
  verifyPassword: vi.fn(),
  preflight: vi.fn(),
  erase: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ isDatabaseConfigured: () => true }));
vi.mock("@/lib/auth/session", () => ({
  getServerAuthSession: mocks.getServerAuthSession,
  parseHeaderValue: (value: string | null) => value?.trim() || null,
}));
vi.mock("@/lib/auth/server", () => ({
  auth: { api: { verifyPassword: mocks.verifyPassword } },
}));
vi.mock("@/lib/auth/identity-erasure", () => ({
  getIdentityErasurePreflight: mocks.preflight,
  eraseIdentity: mocks.erase,
  IdentityErasureError: class IdentityErasureError extends Error {
    constructor(readonly code: string, readonly status: number) { super(code); }
  },
}));

import { GET, POST } from "./route";

const origin = "http://localhost:3002";
const validBody = {
  confirmation: "ERASE",
  acknowledgeAccessLoss: true,
  acknowledgeMembershipRemoval: true,
  exportHandled: true,
  password: "Password123!",
};

function request(method: "GET" | "POST", body?: unknown, requestOrigin = origin) {
  return new NextRequest(`${origin}/api/account/erasure`, {
    method,
    headers: {
      origin: requestOrigin,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

describe("account identity erasure route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getServerAuthSession.mockResolvedValue({
      user: { id: "user-1" },
      session: { createdAt: new Date() },
    });
    mocks.preflight.mockResolvedValue({
      schema: "identity-erasure-preflight/v1",
      canErase: true,
      hasCredential: true,
      requiresFreshSession: false,
      membershipCount: 2,
      ownedWorkspaces: [],
      blockers: [],
    });
    mocks.verifyPassword.mockResolvedValue({ status: true });
    mocks.erase.mockResolvedValue({
      schema: "identity-erasure-result/v1",
      receiptId: `ier_${"a".repeat(32)}`,
      completedAt: "2026-09-05T12:00:00.000Z",
      counts: {},
    });
  });

  it("returns authenticated no-store preflight state", async () => {
    const response = await GET(request("GET"));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({
      success: true,
      preflight: { membershipCount: 2 },
    });
  });

  it("rejects unauthenticated, cross-origin, and inexact confirmation requests", async () => {
    mocks.getServerAuthSession.mockResolvedValueOnce(null);
    expect((await GET(request("GET"))).status).toBe(401);
    expect((await POST(request("POST", validBody, "https://attacker.example"))).status).toBe(403);
    expect((await POST(request("POST", { ...validBody, confirmation: "erase" }))).status).toBe(400);
    expect(mocks.erase).not.toHaveBeenCalled();
  });

  it("requires the current password and rechecks active Workspace ownership", async () => {
    mocks.verifyPassword.mockRejectedValueOnce(new Error("invalid"));
    const wrongPassword = await POST(request("POST", validBody));
    expect(wrongPassword.status).toBe(403);
    expect(await wrongPassword.json()).toMatchObject({ code: "INVALID_PASSWORD" });

    mocks.preflight.mockResolvedValueOnce({
      canErase: false,
      hasCredential: true,
      blockers: [{ code: "ACTIVE_OWNED_WORKSPACE", workspaceId: "workspace-1", workspaceName: "Brand" }],
    });
    const blocked = await POST(request("POST", validBody));
    expect(blocked.status).toBe(409);
    expect(await blocked.json()).toMatchObject({ code: "ACTIVE_OWNED_WORKSPACE" });
    expect(mocks.erase).not.toHaveBeenCalled();
  });

  it("accepts a verified credential user and requires freshness for OAuth-only users", async () => {
    const response = await POST(request("POST", validBody));
    expect(response.status).toBe(200);
    expect(mocks.verifyPassword).toHaveBeenCalledWith(expect.objectContaining({ body: { password: "Password123!" } }));
    expect(mocks.erase).toHaveBeenCalledWith({ userId: "user-1" });

    mocks.preflight.mockResolvedValueOnce({ canErase: true, hasCredential: false, blockers: [] });
    mocks.getServerAuthSession.mockResolvedValueOnce({
      user: { id: "user-1" },
      session: { createdAt: new Date(Date.now() - 16 * 60_000) },
    });
    const stale = await POST(request("POST", { ...validBody, password: undefined }));
    expect(stale.status).toBe(403);
    expect(await stale.json()).toMatchObject({ code: "FRESH_SESSION_REQUIRED" });
  });
});
