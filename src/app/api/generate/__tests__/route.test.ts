import { describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
vi.mock("@/lib/studio/authz", () => ({ authorizeStudioRequest: vi.fn(async (request: NextRequest) => request.headers.get("x-workspace-id") === "ws-test" ? { authorized: true, workspaceId: "ws-test", userId: "user", role: "owner" } : { authorized: false, reason: "workspace_mismatch" }), authzErrorResponse: vi.fn(() => NextResponse.json({ success: false, code: "workspace_mismatch" }, { status: 403 })) }));
import { POST } from "../route";
const request = (workspace = "ws-test") => ({ headers: new Headers({ "x-workspace-id": workspace }) }) as NextRequest;
describe("legacy /api/generate boundary", () => {
  it("requires exact Workspace authority", async () => { const response = await POST(request("")); expect(response.status).toBe(400); });
  it("never dispatches a provider and points callers to admitted generation", async () => { const response = await POST(request()); expect(response.status).toBe(428); await expect(response.json()).resolves.toMatchObject({ success: false, code: "ADMITTED_GENERATION_REQUIRED", next: "/api/studio/generations" }); });
});
