import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const mockAuthorizeStudioRequest = vi.fn();
const mockStreamText = vi.fn();
const mockConvertToModelMessages = vi.fn();

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

vi.mock("ai", () => ({
  streamText: (...args: unknown[]) => mockStreamText(...args),
  convertToModelMessages: (...args: unknown[]) => mockConvertToModelMessages(...args),
  // UIMessage is a type, no runtime mock needed
}));

// Mock AI SDK provider factories — they just need to return a callable that returns a model object
vi.mock("@ai-sdk/google", () => ({
  createGoogleGenerativeAI: () => (modelId: string) => ({ provider: "google", modelId }),
}));

vi.mock("@ai-sdk/openai", () => ({
  createOpenAI: () => (modelId: string) => ({ provider: "openai", modelId }),
}));

vi.mock("@ai-sdk/anthropic", () => ({
  createAnthropic: () => (modelId: string) => ({ provider: "anthropic", modelId }),
}));

import { POST } from "../route";
import { isDatabaseConfigured } from "@/lib/db";

function createRequest(body: Record<string, unknown>): NextRequest {
  return {
    headers: new Headers(),
    json: async () => body,
  } as unknown as NextRequest;
}

const authorizedResult = {
  authorized: true,
  userId: "user_test",
  workspaceId: "ws_test",
  role: "member",
};

describe("POST /api/studio/copy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: DB configured, auth passes, provider factories work
    (isDatabaseConfigured as ReturnType<typeof vi.fn>).mockReturnValue(true);
    mockConvertToModelMessages.mockResolvedValue([]);
  });

  it("returns 503 when database is not configured", async () => {
    (isDatabaseConfigured as ReturnType<typeof vi.fn>).mockReturnValue(false);

    const response = await POST(
      createRequest({ messages: [], model: "gemini-2.5-flash" }),
    );
    const data = await response.json();

    expect(response.status).toBe(503);
    expect(data.success).toBe(false);
    // authorizeStudioRequest must NOT have been called
    expect(mockAuthorizeStudioRequest).not.toHaveBeenCalled();
  });

  it("returns 401 for unauthenticated requests", async () => {
    mockAuthorizeStudioRequest.mockResolvedValue({
      authorized: false,
      status: 401,
      error: "Please sign in to access AI Studio.",
      reason: "unauthenticated",
    });

    const response = await POST(
      createRequest({ messages: [], model: "gemini-2.5-flash" }),
    );
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.success).toBe(false);
    // streamText must NOT have been called
    expect(mockStreamText).not.toHaveBeenCalled();
  });

  it("streams response for authorized requests (happy path)", async () => {
    mockAuthorizeStudioRequest.mockResolvedValue(authorizedResult);

    // Stub env var so createModel passes the API key check
    vi.stubEnv("GEMINI_API_KEY", "test-key");

    const mockStreamResponse = new Response("streamed", { status: 200 });
    const mockResult = {
      toUIMessageStreamResponse: vi.fn().mockReturnValue(mockStreamResponse),
    };
    mockStreamText.mockReturnValue(mockResult);

    const response = await POST(
      createRequest({ messages: [], model: "gemini-2.5-flash", system: "You are helpful." }),
    );

    vi.unstubAllEnvs();

    expect(response.status).toBe(200);
    expect(mockStreamText).toHaveBeenCalledWith(
      expect.objectContaining({ temperature: 0.9 }),
    );
    expect(mockResult.toUIMessageStreamResponse).toHaveBeenCalled();
  });

  it("returns 500 with masked error for unknown model", async () => {
    mockAuthorizeStudioRequest.mockResolvedValue(authorizedResult);

    const response = await POST(
      createRequest({ messages: [], model: "bogus-model" }),
    );
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data.success).toBe(false);
    expect(data.error).toBe("Unsupported model selected");
    expect(mockStreamText).not.toHaveBeenCalled();
  });

  it("returns 500 with masked error when API key is not configured", async () => {
    mockAuthorizeStudioRequest.mockResolvedValue(authorizedResult);

    vi.stubEnv("GEMINI_API_KEY", "");

    const response = await POST(
      createRequest({ messages: [], model: "gemini-2.5-flash" }),
    );
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data.success).toBe(false);
    expect(data.error).toBe("Model API key not configured");
    expect(mockStreamText).not.toHaveBeenCalled();

    vi.unstubAllEnvs();
  });
});
