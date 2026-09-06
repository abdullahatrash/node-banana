import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { getPermissionsForRole } from "@/lib/studio/authz";

const { mockAuthorize, mockIsDatabaseConfigured } = vi.hoisted(() => ({
  mockAuthorize: vi.fn(),
  mockIsDatabaseConfigured: vi.fn(() => true),
}));

vi.mock("@/lib/auth/server", () => ({ auth: { api: { getSession: vi.fn() } } }));
vi.mock("@/lib/db", () => ({ isDatabaseConfigured: () => mockIsDatabaseConfigured() }));
vi.mock("@/lib/api-tokens/auth", () => ({ authorizePublicApiRequest: (...args: unknown[]) => mockAuthorize(...args) }));

import { POST } from "../route";

const request = () => new NextRequest("http://localhost:3000/api/v1/runs", { method: "POST", headers: { authorization: "Bearer nb_x", "content-type": "application/json", "X-Gemini-API-Key": "must-not-be-used" }, body: JSON.stringify({ projectId: "proj_1" }) });
const authorized = { authorized: true, session: { user: { id: "apitoken:ws_1", name: null, email: null }, workspace: { id: "ws_1", organizationId: null }, role: "owner" as const, planTier: "free" as const, permissions: getPermissionsForRole("owner") } };

describe("/api/v1/runs POST", () => {
  beforeEach(() => { vi.clearAllMocks(); mockIsDatabaseConfigured.mockReturnValue(true); });

  it("returns 503 before accepting any legacy provider credential or run", async () => {
    mockAuthorize.mockResolvedValue(authorized);
    const response = await POST(request());
    const body = await response.json();
    expect(response.status).toBe(503);
    expect(body).toMatchObject({ success: false, error: { code: "unavailable" } });
  });

  it("preserves authentication and database fail-closed boundaries", async () => {
    mockIsDatabaseConfigured.mockReturnValue(false);
    expect((await POST(request())).status).toBe(503);
    mockIsDatabaseConfigured.mockReturnValue(true);
    mockAuthorize.mockResolvedValue({ authorized: false, response: NextResponse.json({ success: false }, { status: 401 }) });
    expect((await POST(request())).status).toBe(401);
  });
});
