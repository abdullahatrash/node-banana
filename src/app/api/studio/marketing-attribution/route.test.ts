import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const authorize = vi.fn();
const status = vi.fn();
const setConsent = vi.fn();
vi.mock("@/lib/db", () => ({ isDatabaseConfigured: () => true }));
vi.mock("@/lib/studio/authz", () => ({ authorizeStudioRequest: (...args: unknown[]) => authorize(...args), authzErrorResponse: (result: { status: number; error: string }) => NextResponse.json({ success: false, error: result.error }, { status: result.status }) }));
vi.mock("@/lib/marketing-attribution/production", () => ({ getMarketingAttributionService: () => ({ status: (...args: unknown[]) => status(...args), setConsent: (...args: unknown[]) => setConsent(...args) }) }));

import { GET, POST } from "./route";

describe("/api/studio/marketing-attribution", () => {
  beforeEach(() => { vi.clearAllMocks(); authorize.mockResolvedValue({ authorized: true, userId: "user-1", workspaceId: "workspace-1", role: "member" }); });

  it("returns only the current person's status and no secrets", async () => {
    status.mockResolvedValue({ readiness: { available: false, blockers: ["OAUTH_CREDENTIALS_MISSING"] }, consent: null });
    const response = await GET(new NextRequest("http://localhost/api/studio/marketing-attribution"), undefined);
    expect(response.status).toBe(200);
    expect(status).toHaveBeenCalledWith("workspace-1", "user-1");
    expect(JSON.stringify(await response.json())).not.toMatch(/accessToken|apiSecret/);
  });

  it("requires replay protection and records a bounded explicit choice", async () => {
    const expiresAt = "2026-12-03T12:00:00.000Z";
    const missing = await POST(new NextRequest("http://localhost/api/studio/marketing-attribution", { method: "POST", body: JSON.stringify({ status: "active", expiresAt }) }), undefined);
    expect(missing.status).toBe(400);
    setConsent.mockResolvedValue({ consent: { revision: 1, status: "active" }, replayed: false, scrubbedPendingEvents: 0 });
    const response = await POST(new NextRequest("http://localhost/api/studio/marketing-attribution", { method: "POST", headers: { "idempotency-key": "attribution-command-1" }, body: JSON.stringify({ status: "active", expiresAt }) }), undefined);
    expect(response.status).toBe(201);
    expect(setConsent).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: "workspace-1", userId: "user-1", status: "active", expiresAt: new Date(expiresAt), idempotencyKey: "attribution-command-1" }));
  });
});
