import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

// Use vi.hoisted to define mocks that work with hoisted vi.mock
const { mockGenerateContent, MockGoogleGenAI, mockGoogleGenAIInstance } = vi.hoisted(() => {
  const mockGenerateContent = vi.fn();
  const mockGoogleGenAIInstance = {
    models: {
      generateContent: mockGenerateContent,
    },
  };
  class MockGoogleGenAI {
    apiKey: string;
    models = mockGoogleGenAIInstance.models;

    constructor(config: { apiKey: string }) {
      this.apiKey = config.apiKey;
      MockGoogleGenAI.lastCalledWith = config;
      MockGoogleGenAI.callCount++;
    }

    static lastCalledWith: { apiKey: string } | null = null;
    static callCount = 0;
    static reset() {
      MockGoogleGenAI.lastCalledWith = null;
      MockGoogleGenAI.callCount = 0;
    }
  }
  return { mockGenerateContent, MockGoogleGenAI, mockGoogleGenAIInstance };
});

vi.mock("@google/genai", () => ({
  GoogleGenAI: MockGoogleGenAI,
}));

// `next/headers` is only used by the templateId branch (to build a base URL
// for local sample images); stub it so the BYOK-focused tests below never
// touch real request headers machinery.
vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers({ host: "localhost:3000" })),
}));

// BYOK vault shim: mirrors the pattern in src/app/api/llm/__tests__/route.test.ts —
// the route resolves keys via resolveInferenceKey, whose vault tier delegates to
// resolveProviderKey. Mock the repository so tests never touch the database.
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
): NextRequest {
  return {
    json: vi.fn().mockResolvedValue(body),
    headers: new Headers({ "x-workspace-id": "ws-test", ...headers }),
  } as unknown as NextRequest;
}

describe("/api/quickstart route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    MockGoogleGenAI.reset();
    process.env = { ...originalEnv };
    mockedResolveProviderKey.mockImplementation(
      async (_workspaceId: string, provider: string) =>
        process.env[PROVIDER_ENV_MAP[provider]] ?? null,
    );
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("generates a workflow successfully using the vault-resolved Gemini key", async () => {
    delete process.env.GEMINI_API_KEY;
    mockedResolveProviderKey.mockResolvedValue("vault-gemini-key");

    mockGenerateContent.mockResolvedValueOnce({
      text: JSON.stringify({
        id: "wf_1",
        version: 1,
        name: "Generated",
        edgeStyle: "curved",
        nodes: [],
        edges: [],
      }),
    });

    const request = createMockPostRequest({
      description: "Create a product photo workflow",
      contentLevel: "full",
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(MockGoogleGenAI.lastCalledWith).toEqual({ apiKey: "vault-gemini-key" });
  });

  it("uses the X-Gemini-API-Key header over the vault", async () => {
    mockedResolveProviderKey.mockResolvedValue("vault-gemini-key");

    mockGenerateContent.mockResolvedValueOnce({
      text: JSON.stringify({
        id: "wf_1",
        version: 1,
        name: "Generated",
        edgeStyle: "curved",
        nodes: [],
        edges: [],
      }),
    });

    const request = createMockPostRequest(
      { description: "Create a product photo workflow", contentLevel: "full" },
      { "X-Gemini-API-Key": "header-gemini-key" }
    );

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(MockGoogleGenAI.lastCalledWith).toEqual({ apiKey: "header-gemini-key" });
  });

  it("returns a typed byok_key_missing error when no key is resolvable", async () => {
    delete process.env.GEMINI_API_KEY;
    mockedResolveProviderKey.mockResolvedValue(null);

    const request = createMockPostRequest({
      description: "Create a product photo workflow",
      contentLevel: "full",
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);
    expect(data.success).toBe(false);
    expect(data.code).toBe("byok_key_missing");
    expect(data.provider).toBe("gemini");
    expect(data.error).toContain("Google Gemini");
    expect(data.error).toContain("Provider Keys");
    expect(data.error).not.toMatch(/GEMINI_API_KEY|process\.env/);
  });

  it("never falls back to the server env key", async () => {
    process.env.GEMINI_API_KEY = "env-gemini-key";
    mockedResolveProviderKey.mockResolvedValue(null);

    const request = createMockPostRequest({
      description: "Create a product photo workflow",
      contentLevel: "full",
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);
    expect(data.code).toBe("byok_key_missing");
    expect(MockGoogleGenAI.callCount).toBe(0);
  });

  it("does not require a resolvable key for the preset templateId path", async () => {
    delete process.env.GEMINI_API_KEY;
    mockedResolveProviderKey.mockResolvedValue(null);

    const request = createMockPostRequest({
      templateId: "product-shot",
      contentLevel: "full",
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(MockGoogleGenAI.callCount).toBe(0);
  });
});
