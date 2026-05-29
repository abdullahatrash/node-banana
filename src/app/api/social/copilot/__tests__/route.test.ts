import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { mockWithApiPermission, mockStreamCopilotResponse } = vi.hoisted(() => ({
  mockWithApiPermission: vi.fn(),
  mockStreamCopilotResponse: vi.fn(),
}));

vi.mock("@/lib/studio/authz", () => ({
  withApiPermission: mockWithApiPermission,
}));

vi.mock("@/lib/social/copilot/agent", () => ({
  streamCopilotResponse: mockStreamCopilotResponse,
}));

import { POST } from "../route";

function authorizedResult() {
  return {
    authorized: true,
    session: {
      user: { id: "u_1", name: null, email: null },
      workspace: { id: "ws_1", organizationId: null },
      role: "owner",
      planTier: "pro",
      permissions: ["social:view"],
    },
  };
}

function postRequest(
  body: unknown,
  headers: Record<string, string> = {},
): NextRequest {
  return new NextRequest("http://localhost/api/social/copilot", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

describe("POST /api/social/copilot", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStreamCopilotResponse.mockReturnValue(
      new Response("stream", { status: 200 }),
    );
  });

  it("returns the authorization failure response when not permitted", async () => {
    mockWithApiPermission.mockResolvedValue({
      authorized: false,
      response: Response.json(
        { success: false, error: "forbidden" },
        { status: 403 },
      ),
    });

    const res = await POST(
      postRequest({ messages: [] }, { "X-Anthropic-API-Key": "ak" }),
    );

    expect(res.status).toBe(403);
    expect(mockStreamCopilotResponse).not.toHaveBeenCalled();
  });

  it("returns a 4xx Settings-prompt error when the API key is missing", async () => {
    mockWithApiPermission.mockResolvedValue(authorizedResult());

    const res = await POST(postRequest({ messages: [] }));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/settings/i);
    expect(mockStreamCopilotResponse).not.toHaveBeenCalled();
  });

  it("delegates to the copilot stream with workspace-scoped context when authorized and keyed", async () => {
    mockWithApiPermission.mockResolvedValue(authorizedResult());

    const res = await POST(
      postRequest(
        { messages: [{ role: "user" }] },
        { "X-Anthropic-API-Key": "ak-123" },
      ),
    );

    expect(res.status).toBe(200);
    expect(mockStreamCopilotResponse).toHaveBeenCalledTimes(1);
    expect(mockStreamCopilotResponse.mock.calls[0][0]).toMatchObject({
      provider: "anthropic",
      modelId: "claude-sonnet-4-6",
      apiKey: "ak-123",
      ctx: { workspaceId: "ws_1", userId: "u_1" },
    });
  });
});
