import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const mockAuthorizeStudioRequest = vi.fn();
const mockStreamText = vi.fn();
const mockConvertToModelMessages = vi.fn();
const mockRecordSafeOperationalTrace = vi.fn<
  (input: unknown) => Promise<string | null>
>(
  async (_input: unknown) => "otr_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
);

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

vi.mock("@/lib/agent-runtime/safe-diagnostics", () => ({
  recordSafeOperationalTrace: (input: unknown) =>
    mockRecordSafeOperationalTrace(input),
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
    mockRecordSafeOperationalTrace.mockResolvedValue(
      "otr_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    );
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
    expect(response.headers.get("Cache-Control")).toBe("no-store");
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
    expect(data.code).toBe("COPY_GENERATION_FAILED");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
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

  it("keeps synchronous provider failures out of responses, traces, and console", async () => {
    mockAuthorizeStudioRequest.mockResolvedValue(authorizedResult);
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    const canary =
      "PROMPT_CANARY api_key=secret Authorization: Bearer token Cookie=secret https://signed.example/private";
    mockConvertToModelMessages.mockRejectedValue(new Error(canary));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await POST(
      createRequest({ messages: [{ content: canary }], model: "gemini-2.5-flash" }),
    );
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(data).toMatchObject({
      success: false,
      error: "Copy generation failed",
      code: "COPY_GENERATION_FAILED",
      operatorTraceRef: "otr_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    });
    expect(JSON.stringify(data)).not.toContain(canary);
    expect(JSON.stringify(mockRecordSafeOperationalTrace.mock.calls)).not.toContain(canary);
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain(canary);
    consoleError.mockRestore();
    vi.unstubAllEnvs();
  });

  it("returns a null trace reference when diagnostic persistence is unavailable", async () => {
    mockAuthorizeStudioRequest.mockResolvedValue(authorizedResult);
    mockRecordSafeOperationalTrace.mockResolvedValue(null);

    const response = await POST(
      createRequest({ messages: [], model: "bogus-model" }),
    );

    await expect(response.json()).resolves.toMatchObject({
      success: false,
      code: "COPY_GENERATION_FAILED",
      operatorTraceRef: null,
    });
  });

  it("masks asynchronous stream failures and records only a fixed diagnostic", async () => {
    mockAuthorizeStudioRequest.mockResolvedValue(authorizedResult);
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    const mockStreamResponse = new Response("streamed", { status: 200 });
    const mockResult = {
      toUIMessageStreamResponse: vi.fn().mockReturnValue(mockStreamResponse),
    };
    mockStreamText.mockReturnValue(mockResult);

    const response = await POST(
      createRequest({ messages: [], model: "gpt-4.1-mini" }),
    );
    const streamOptions = mockStreamText.mock.calls[0][0] as {
      onError: (event: { error: unknown }) => Promise<void>;
    };
    const canary = "provider_body=secret signed_url=https://private.example";
    await streamOptions.onError({ error: new Error(canary) });
    const clientOptions = mockResult.toUIMessageStreamResponse.mock.calls[0][0] as {
      onError: (error: unknown) => string;
    };

    expect(clientOptions.onError(new Error(canary))).toBe("Copy generation failed");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(JSON.stringify(mockRecordSafeOperationalTrace.mock.calls)).not.toContain(canary);
    expect(mockRecordSafeOperationalTrace).toHaveBeenLastCalledWith(
      expect.objectContaining({
        workspaceId: "ws_test",
        category: "provider",
        code: "COPY_GENERATION_FAILED",
        providerFamily: "openai",
      }),
    );
    vi.unstubAllEnvs();
  });
});
