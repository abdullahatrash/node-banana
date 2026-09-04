import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const authorize = vi.fn();
const getConsent = vi.fn();
const setConsent = vi.fn();

vi.mock("@/lib/db", () => ({ isDatabaseConfigured: () => true }));
vi.mock("@/lib/studio/authz", () => ({ authorizeStudioRequest: (...args: unknown[]) => authorize(...args), authzErrorResponse: (result: { status: number; error: string }) => NextResponse.json({ success: false, error: result.error }, { status: result.status }) }));
vi.mock("@/lib/release-control/production", () => ({ getReleaseControlService: () => ({ getTelemetryConsent: (...args: unknown[]) => getConsent(...args), setTelemetryConsent: (...args: unknown[]) => setConsent(...args) }) }));

import { GET, POST } from "./route";

describe("/api/studio/product-telemetry/consent", () => {
  beforeEach(() => { vi.clearAllMocks(); authorize.mockResolvedValue({ authorized: true, userId: "user-1", workspaceId: "workspace-1", role: "member" }); });

  it("returns only the signed-in person's Workspace consent with no-store caching", async () => {
    getConsent.mockResolvedValue(null);
    const response = await GET(new NextRequest("http://localhost/api/studio/product-telemetry/consent"), undefined);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(getConsent).toHaveBeenCalledWith("workspace-1", "user-1");
  });

  it("requires idempotency and appends an explicit bounded consent revision", async () => {
    const expiresAt = "2026-12-03T12:00:00.000Z";
    setConsent.mockResolvedValue({ replayed: false, consent: { revision: 1, status: "active" } });
    const missing = await POST(new NextRequest("http://localhost/api/studio/product-telemetry/consent", { method: "POST", body: JSON.stringify({ status: "active", expiresAt }) }), undefined);
    expect(missing.status).toBe(400);
    const response = await POST(new NextRequest("http://localhost/api/studio/product-telemetry/consent", { method: "POST", headers: { "idempotency-key": "privacy-command-1" }, body: JSON.stringify({ status: "active", expiresAt }) }), undefined);
    expect(response.status).toBe(201);
    expect(setConsent).toHaveBeenCalledWith("workspace-1", "user-1", "active", new Date(expiresAt), "privacy-command-1");
  });
});
