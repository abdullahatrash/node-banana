import { describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
vi.mock("@/lib/studio/authz", () => ({ authorizeStudioRequest: vi.fn(async (request: NextRequest) => request.headers.get("x-workspace-id") === "ws-test" ? { authorized: true, workspaceId: "ws-test", userId: "user", role: "owner" } : { authorized: false, reason: "workspace_mismatch" }), authzErrorResponse: vi.fn(() => NextResponse.json({ success: false }, { status: 403 })) }));
import { POST } from "../route";
describe("legacy /api/llm boundary", () => { it("fails closed before any text provider execution", async () => { const response = await POST(({ headers: new Headers({ "x-workspace-id": "ws-test" }) }) as NextRequest); expect(response.status).toBe(428); await expect(response.json()).resolves.toMatchObject({ code: "ADMITTED_GENERATION_REQUIRED" }); }); });
