import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const mockAuthorizeStudioRequest = vi.fn();
const mockListPrompts = vi.fn();
const mockCreatePrompt = vi.fn();

vi.mock("@/lib/db", () => ({
  isDatabaseConfigured: vi.fn(() => true),
}));

vi.mock("@/lib/studio/authz", () => {
  return {
    authorizeStudioRequest: (...args: unknown[]) => mockAuthorizeStudioRequest(...args),
    authzErrorResponse: (result: { status: number; error: string }) =>
      NextResponse.json(
        { success: false, error: result.error },
        { status: result.status },
      ),
  };
});

vi.mock("@/lib/studio/repository", () => ({
  listPrompts: (...args: unknown[]) => mockListPrompts(...args),
  createPrompt: (...args: unknown[]) => mockCreatePrompt(...args),
}));

import { GET, POST } from "../route";

function createGetRequest(mode?: string): NextRequest {
  const url = mode
    ? `http://localhost:3000/api/studio/prompts?mode=${mode}`
    : "http://localhost:3000/api/studio/prompts";
  return {
    headers: new Headers(),
    nextUrl: new URL(url),
    json: vi.fn(),
  } as unknown as NextRequest;
}

function createPostRequest(body: Record<string, unknown>): NextRequest {
  return {
    headers: new Headers(),
    nextUrl: new URL("http://localhost:3000/api/studio/prompts"),
    json: vi.fn().mockResolvedValue(body),
  } as unknown as NextRequest;
}

const authorizedResult = {
  authorized: true,
  workspaceId: "ws_test",
  userId: "user_test",
};

describe("/api/studio/prompts GET", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 for unauthenticated requests", async () => {
    mockAuthorizeStudioRequest.mockResolvedValue({
      authorized: false,
      status: 401,
      error: "Please sign in to access AI Studio.",
      reason: "unauthenticated",
    });

    const response = await GET(createGetRequest());
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.success).toBe(false);
  });

  it("returns 403 for non-members", async () => {
    mockAuthorizeStudioRequest.mockResolvedValue({
      authorized: false,
      status: 403,
      error: "No access to this workspace.",
      reason: "forbidden",
    });

    const response = await GET(createGetRequest());
    expect(response.status).toBe(403);
  });

  it("returns prompts for authorized user", async () => {
    mockAuthorizeStudioRequest.mockResolvedValue(authorizedResult);
    mockListPrompts.mockResolvedValue([
      { id: "sp_1", name: "Test Prompt", mode: "photo" },
    ]);

    const response = await GET(createGetRequest());
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.prompts).toHaveLength(1);
    expect(mockListPrompts).toHaveBeenCalledWith("ws_test", undefined);
  });

  it("filters by mode when provided", async () => {
    mockAuthorizeStudioRequest.mockResolvedValue(authorizedResult);
    mockListPrompts.mockResolvedValue([]);

    await GET(createGetRequest("video"));

    expect(mockListPrompts).toHaveBeenCalledWith("ws_test", "video");
  });

  it("returns 400 for invalid mode", async () => {
    mockAuthorizeStudioRequest.mockResolvedValue(authorizedResult);

    const response = await GET(createGetRequest("invalid"));
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
  });
});

describe("/api/studio/prompts POST", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 400 when name is missing", async () => {
    mockAuthorizeStudioRequest.mockResolvedValue(authorizedResult);

    const response = await POST(
      createPostRequest({ mode: "photo", promptText: "test" }),
    );
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toContain("name");
  });

  it("returns 400 when promptText is missing", async () => {
    mockAuthorizeStudioRequest.mockResolvedValue(authorizedResult);

    const response = await POST(
      createPostRequest({ mode: "photo", name: "Test" }),
    );
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toContain("text");
  });

  it("returns 400 for invalid mode", async () => {
    mockAuthorizeStudioRequest.mockResolvedValue(authorizedResult);

    const response = await POST(
      createPostRequest({ mode: "invalid", name: "Test", promptText: "test" }),
    );
    expect(response.status).toBe(400);
  });

  it("creates prompt for valid input", async () => {
    mockAuthorizeStudioRequest.mockResolvedValue(authorizedResult);
    mockCreatePrompt.mockResolvedValue({
      id: "sp_123",
      name: "My Prompt",
      mode: "photo",
      promptText: "Generate a product photo",
      formConfig: { aspectRatio: "1:1" },
    });

    const response = await POST(
      createPostRequest({
        mode: "photo",
        name: "My Prompt",
        promptText: "Generate a product photo",
        formConfig: { aspectRatio: "1:1" },
      }),
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.prompt.name).toBe("My Prompt");
    expect(mockCreatePrompt).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "ws_test",
        mode: "photo",
        name: "My Prompt",
        promptText: "Generate a product photo",
      }),
    );
  });
});
