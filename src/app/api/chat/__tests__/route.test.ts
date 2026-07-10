import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Use vi.hoisted so mocks are available inside hoisted vi.mock factories.
const { mockStreamText, mockCreateGoogleGenerativeAI, mockGoogleProviderFn } = vi.hoisted(() => {
  const mockGoogleProviderFn = vi.fn((modelId: string) => ({ modelId }));
  const mockCreateGoogleGenerativeAI = vi.fn((config: { apiKey: string }) => {
    mockCreateGoogleGenerativeAI.lastCalledWith = config;
    return mockGoogleProviderFn;
  }) as unknown as ReturnType<typeof vi.fn> & { lastCalledWith?: { apiKey: string } };
  const mockStreamText = vi.fn(() => ({
    toUIMessageStreamResponse: () => new Response("stream", { status: 200 }),
  }));
  return { mockStreamText, mockCreateGoogleGenerativeAI, mockGoogleProviderFn };
});

vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return {
    ...actual,
    streamText: mockStreamText,
    convertToModelMessages: vi.fn(async (messages: unknown) => messages),
    stepCountIs: vi.fn(() => () => false),
  };
});

vi.mock("@ai-sdk/google", () => ({
  createGoogleGenerativeAI: mockCreateGoogleGenerativeAI,
}));

vi.mock("@/lib/chat/tools", () => ({
  createChatTools: vi.fn(() => ({})),
  buildEditSystemPrompt: vi.fn(() => "system prompt"),
}));

vi.mock("@/lib/chat/contextBuilder", () => ({
  buildWorkflowContext: vi.fn(() => ({})),
}));

vi.mock("@/lib/chat/subgraphExtractor", () => ({
  extractSubgraph: vi.fn(() => ({
    selectedNodes: [],
    selectedEdges: [],
    restSummary: undefined,
  })),
}));

// BYOK vault shim: mirrors src/app/api/llm/__tests__/route.test.ts.
const PROVIDER_ENV_MAP: Record<string, string> = {
  gemini: "GEMINI_API_KEY",
};

vi.mock("@/lib/byok/repository", () => ({
  resolveProviderKey: vi.fn(
    async (_workspaceId: string, provider: string) =>
      process.env[PROVIDER_ENV_MAP[provider]] ?? null,
  ),
}));

import { resolveProviderKey } from "@/lib/byok/repository";
import { POST } from "../route";

const mockedResolveProviderKey = vi.mocked(resolveProviderKey);

const originalEnv = { ...process.env };

function createMockPostRequest(
  body: unknown,
  headers?: Record<string, string>
): Request {
  return {
    json: vi.fn().mockResolvedValue(body),
    headers: new Headers({ "x-workspace-id": "ws-test", ...headers }),
  } as unknown as Request;
}

describe("/api/chat route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateGoogleGenerativeAI.lastCalledWith = undefined;
    process.env = { ...originalEnv };
    mockedResolveProviderKey.mockImplementation(
      async (_workspaceId: string, provider: string) =>
        process.env[PROVIDER_ENV_MAP[provider]] ?? null,
    );
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("streams a response using the vault-resolved Gemini key", async () => {
    delete process.env.GEMINI_API_KEY;
    mockedResolveProviderKey.mockResolvedValue("vault-gemini-key");

    const request = createMockPostRequest({ messages: [] });
    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(mockCreateGoogleGenerativeAI.lastCalledWith).toEqual({
      apiKey: "vault-gemini-key",
    });
  });

  it("uses the X-Gemini-API-Key header over the vault", async () => {
    mockedResolveProviderKey.mockResolvedValue("vault-gemini-key");

    const request = createMockPostRequest(
      { messages: [] },
      { "X-Gemini-API-Key": "header-gemini-key" }
    );
    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(mockCreateGoogleGenerativeAI.lastCalledWith).toEqual({
      apiKey: "header-gemini-key",
    });
  });

  it("returns a typed byok_key_missing error when no key is resolvable", async () => {
    delete process.env.GEMINI_API_KEY;
    mockedResolveProviderKey.mockResolvedValue(null);

    const request = createMockPostRequest({ messages: [] });
    const response = await POST(request);
    const text = await response.text();

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);
    expect(text).toContain("Google Gemini");
    expect(text).toContain("Provider Keys");
    expect(text).not.toMatch(/GEMINI_API_KEY|process\.env/);
    expect(mockStreamText).not.toHaveBeenCalled();
  });

  it("never falls back to the server env key", async () => {
    process.env.GEMINI_API_KEY = "env-gemini-key";
    mockedResolveProviderKey.mockResolvedValue(null);

    const request = createMockPostRequest({ messages: [] });
    const response = await POST(request);

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);
    expect(mockStreamText).not.toHaveBeenCalled();
  });
});
