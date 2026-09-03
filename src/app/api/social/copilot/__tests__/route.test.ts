import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { mockWithApiPermission } = vi.hoisted(() => ({ mockWithApiPermission: vi.fn() }));
vi.mock("@/lib/studio/authz", () => ({ withApiPermission: mockWithApiPermission }));
import { POST } from "../route";

const request = () => new NextRequest("http://localhost/api/social/copilot", { method: "POST", headers: { "content-type": "application/json", "X-Anthropic-API-Key": "must-not-be-used" }, body: JSON.stringify({ messages: [] }) });

describe("POST /api/social/copilot", () => {
  beforeEach(() => vi.clearAllMocks());

  it("preserves authorization", async () => {
    mockWithApiPermission.mockResolvedValue({ authorized: false, response: Response.json({ success: false }, { status: 403 }) });
    expect((await POST(request())).status).toBe(403);
  });

  it("fails closed without invoking a direct provider", async () => {
    mockWithApiPermission.mockResolvedValue({ authorized: true, session: { user: { id: "u_1" }, workspace: { id: "ws_1" } } });
    const response = await POST(request());
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ success: false, code: "SOCIAL_COPILOT_ADMITTED_GENERATION_UNAVAILABLE", nextAction: { href: "/studio/model-routing" } });
  });
});
