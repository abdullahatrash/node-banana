import { describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
const authorize = vi.fn();
vi.mock("@/lib/studio/authz", () => ({ authorizeStudioRequest: (...args: unknown[]) => authorize(...args), authzErrorResponse: vi.fn(() => NextResponse.json({ success: false }, { status: 401 })) }));
import { POST } from "../route";
describe("Simple Studio copy boundary", () => {
  it("preserves authentication before failing closed", async () => { authorize.mockResolvedValueOnce({ authorized: false }); expect((await POST({} as NextRequest)).status).toBe(401); });
  it("does not silently use an unadmitted text provider", async () => { authorize.mockResolvedValueOnce({ authorized: true, workspaceId: "ws", userId: "u", role: "member" }); const response = await POST({} as NextRequest); expect(response.status).toBe(428); await expect(response.json()).resolves.toMatchObject({ code: "ADMITTED_GENERATION_REQUIRED" }); });
});
