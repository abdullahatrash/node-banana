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
  // Use a class to properly support `new` keyword
  class MockGoogleGenAI {
    apiKey: string;
    models = mockGoogleGenAIInstance.models;

    constructor(config: { apiKey: string }) {
      this.apiKey = config.apiKey;
      // Track calls to constructor
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

// Mock logger to avoid console noise during tests
vi.mock("@/utils/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// BYOK vault shim: the route resolves keys via resolveInferenceKey, whose vault
// tier delegates to resolveProviderKey. Mock the repository so tests never touch
// the database; by default the vault mirrors process.env so the existing
// generation-behavior tests keep providing a key by setting env (which the route
// no longer reads directly). Requests carry a default `x-workspace-id`.
const PROVIDER_ENV_MAP: Record<string, string> = {
  gemini: "GEMINI_API_KEY",
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
};

vi.mock("@/lib/byok/repository", () => ({
  resolveProviderKey: vi.fn(
    async (_workspaceId: string, provider: string) =>
      process.env[PROVIDER_ENV_MAP[provider]] ?? null,
  ),
}));

vi.mock("@/lib/governance/production", () => ({
  admitProductionGovernanceRegionRoute: vi.fn(async () => ({ allowed: true, policyApplied: false })),
}));

import { resolveProviderKey } from "@/lib/byok/repository";
import { POST } from "../route";

const mockedResolveProviderKey = vi.mocked(resolveProviderKey);

// Store original env and fetch
const originalEnv = { ...process.env };
const originalFetch = global.fetch;

// Mock fetch for OpenAI API
const mockFetch = vi.fn();

// Helper to create mock NextRequest for POST. Injects a default workspace
// header so the BYOK vault tier is active; override via `headers`.
function createMockPostRequest(
  body: unknown,
  headers?: Record<string, string>
): NextRequest {
  return {
    json: vi.fn().mockResolvedValue(body),
    headers: new Headers({ "x-workspace-id": "ws-test", ...headers }),
  } as unknown as NextRequest;
}

describe("/api/llm route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    MockGoogleGenAI.reset();
    // Reset env to original
    process.env = { ...originalEnv };
    // Re-establish the default env-mirroring vault shim after clearAllMocks.
    mockedResolveProviderKey.mockImplementation(
      async (_workspaceId: string, provider: string) =>
        process.env[PROVIDER_ENV_MAP[provider]] ?? null,
    );
  });

  afterEach(() => {
    process.env = originalEnv;
    global.fetch = originalFetch;
  });

  describe("Google provider", () => {
    it("should generate text successfully with Google/Gemini", async () => {
      process.env.GEMINI_API_KEY = "test-gemini-key";

      mockGenerateContent.mockResolvedValueOnce({
        text: "Generated response from Gemini",
      });

      const request = createMockPostRequest({
        prompt: "Test prompt",
        provider: "google",
        model: "gemini-2.5-flash",
        temperature: 0.7,
        maxTokens: 1024,
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.text).toBe("Generated response from Gemini");
      expect(mockGenerateContent).toHaveBeenCalledWith({
        model: "gemini-2.5-flash",
        contents: "Test prompt",
        config: {
          temperature: 0.7,
          maxOutputTokens: 1024,
        },
      });
    });

    it("should handle multimodal input (images + prompt)", async () => {
      process.env.GEMINI_API_KEY = "test-gemini-key";

      mockGenerateContent.mockResolvedValueOnce({
        text: "Description of the image",
      });

      const request = createMockPostRequest({
        prompt: "Describe this image",
        images: ["data:image/png;base64,iVBORw0KGgo="],
        provider: "google",
        model: "gemini-2.5-flash",
        temperature: 0.7,
        maxTokens: 1024,
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.text).toBe("Description of the image");

      // Verify multimodal content structure
      expect(mockGenerateContent).toHaveBeenCalledWith({
        model: "gemini-2.5-flash",
        contents: [
          {
            inlineData: {
              mimeType: "image/png",
              data: "iVBORw0KGgo=",
            },
          },
          { text: "Describe this image" },
        ],
        config: {
          temperature: 0.7,
          maxOutputTokens: 1024,
        },
      });
    });

    it("should reject missing prompt", async () => {
      process.env.GEMINI_API_KEY = "test-gemini-key";

      const request = createMockPostRequest({
        provider: "google",
        model: "gemini-2.5-flash",
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error).toBe("Prompt is required");
    });

    it("returns a typed byok_key_missing error when no key is resolvable", async () => {
      delete process.env.GEMINI_API_KEY;
      mockedResolveProviderKey.mockResolvedValue(null);

      const request = createMockPostRequest({
        prompt: "Test prompt",
        provider: "google",
        model: "gemini-2.5-flash",
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

    it("resolves the Gemini key from the workspace vault when no header is set", async () => {
      delete process.env.GEMINI_API_KEY;
      mockedResolveProviderKey.mockResolvedValue("vault-gemini-key");

      mockGenerateContent.mockResolvedValueOnce({ text: "vault response" });

      const request = createMockPostRequest({
        prompt: "Test prompt",
        provider: "google",
        model: "gemini-2.5-flash",
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(MockGoogleGenAI.lastCalledWith).toEqual({ apiKey: "vault-gemini-key" });
    });

    it("never falls back to the server env key for Gemini", async () => {
      process.env.GEMINI_API_KEY = "env-gemini-key";
      mockedResolveProviderKey.mockResolvedValue(null);

      const request = createMockPostRequest({
        prompt: "Test prompt",
        provider: "google",
        model: "gemini-2.5-flash",
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(response.status).toBeLessThan(500);
      expect(data.code).toBe("byok_key_missing");
      expect(MockGoogleGenAI.callCount).toBe(0);
    });

    it("should use X-Gemini-API-Key header over the vault", async () => {
      mockedResolveProviderKey.mockResolvedValue("vault-gemini-key");

      mockGenerateContent.mockResolvedValueOnce({
        text: "Response with header key",
      });

      const request = createMockPostRequest(
        {
          prompt: "Test prompt",
          provider: "google",
          model: "gemini-2.5-flash",
        },
        { "X-Gemini-API-Key": "header-gemini-key" }
      );

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);

      // Verify GoogleGenAI was called with header key (takes precedence)
      expect(MockGoogleGenAI.lastCalledWith).toEqual({ apiKey: "header-gemini-key" });
    });

    it("should return 429 on rate limit errors", async () => {
      process.env.GEMINI_API_KEY = "test-gemini-key";

      mockGenerateContent.mockRejectedValueOnce(
        new Error("429 Resource exhausted")
      );

      const request = createMockPostRequest({
        prompt: "Test prompt",
        provider: "google",
        model: "gemini-2.5-flash",
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(429);
      expect(data.success).toBe(false);
      expect(data.error).toBe("Rate limit reached. Please wait and try again.");
    });

    it("should return 500 on API errors", async () => {
      process.env.GEMINI_API_KEY = "test-gemini-key";

      mockGenerateContent.mockRejectedValueOnce(
        new Error("Internal server error")
      );

      const request = createMockPostRequest({
        prompt: "Test prompt",
        provider: "google",
        model: "gemini-2.5-flash",
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.success).toBe(false);
      expect(data.error).toBe("Internal server error");
    });

    it("should handle no text in Google AI response", async () => {
      process.env.GEMINI_API_KEY = "test-gemini-key";

      mockGenerateContent.mockResolvedValueOnce({
        text: null,
      });

      const request = createMockPostRequest({
        prompt: "Test prompt",
        provider: "google",
        model: "gemini-2.5-flash",
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.success).toBe(false);
      expect(data.error).toBe("No text in Google AI response");
    });

    it("should handle image without data URL prefix", async () => {
      process.env.GEMINI_API_KEY = "test-gemini-key";

      mockGenerateContent.mockResolvedValueOnce({
        text: "Image description",
      });

      const request = createMockPostRequest({
        prompt: "Describe this",
        images: ["iVBORw0KGgoAAAANSUhEUgAAAAUA"], // raw base64, no prefix
        provider: "google",
        model: "gemini-2.5-flash",
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);

      // Verify fallback to PNG mime type
      expect(mockGenerateContent).toHaveBeenCalledWith({
        model: "gemini-2.5-flash",
        contents: [
          {
            inlineData: {
              mimeType: "image/png",
              data: "iVBORw0KGgoAAAANSUhEUgAAAAUA",
            },
          },
          { text: "Describe this" },
        ],
        config: {
          temperature: 0.7,
          maxOutputTokens: 1024,
        },
      });
    });
  });

  describe("OpenAI provider", () => {
    beforeEach(() => {
      global.fetch = mockFetch;
    });

    it("should generate text successfully with OpenAI", async () => {
      process.env.OPENAI_API_KEY = "test-openai-key";

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            choices: [{ message: { content: "OpenAI response text" } }],
          }),
      });

      const request = createMockPostRequest({
        prompt: "Test prompt",
        provider: "openai",
        model: "gpt-4.1-mini",
        temperature: 0.7,
        maxTokens: 1024,
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.text).toBe("OpenAI response text");

      // Verify fetch was called with correct parameters
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.openai.com/v1/chat/completions",
        expect.objectContaining({
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer test-openai-key",
          },
          body: JSON.stringify({
            model: "gpt-4.1-mini",
            messages: [{ role: "user", content: "Test prompt" }],
            temperature: 0.7,
            max_tokens: 1024,
          }),
        })
      );
    });

    it("should handle vision input (images + prompt)", async () => {
      process.env.OPENAI_API_KEY = "test-openai-key";

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            choices: [{ message: { content: "Image description from OpenAI" } }],
          }),
      });

      const request = createMockPostRequest({
        prompt: "Describe this image",
        images: ["data:image/png;base64,iVBORw0KGgo="],
        provider: "openai",
        model: "gpt-4.1-mini",
        temperature: 0.7,
        maxTokens: 1024,
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.text).toBe("Image description from OpenAI");

      // Verify fetch was called with vision content structure
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.openai.com/v1/chat/completions",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            model: "gpt-4.1-mini",
            messages: [
              {
                role: "user",
                content: [
                  { type: "text", text: "Describe this image" },
                  { type: "image_url", image_url: { url: "data:image/png;base64,iVBORw0KGgo=" } },
                ],
              },
            ],
            temperature: 0.7,
            max_tokens: 1024,
          }),
        })
      );
    });

    it("should reject unknown provider", async () => {
      const request = createMockPostRequest({
        prompt: "Test prompt",
        provider: "unknown-provider",
        model: "some-model",
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error).toBe("Unknown provider: unknown-provider");
    });

    it("should reject missing OpenAI API key with typed byok error", async () => {
      delete process.env.OPENAI_API_KEY;
      mockedResolveProviderKey.mockResolvedValue(null);

      const request = createMockPostRequest({
        prompt: "Test prompt",
        provider: "openai",
        model: "gpt-4.1-mini",
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(response.status).toBeLessThan(500);
      expect(data.success).toBe(false);
      expect(data.code).toBe("byok_key_missing");
      expect(data.provider).toBe("openai");
      expect(data.error).toContain("OpenAI");
      expect(data.error).toContain("Provider Keys");
      expect(data.error).not.toMatch(/OPENAI_API_KEY|process\.env/);
    });

    it("should use X-OpenAI-API-Key header over the vault", async () => {
      process.env.OPENAI_API_KEY = "env-openai-key";

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            choices: [{ message: { content: "Response with header key" } }],
          }),
      });

      const request = createMockPostRequest(
        {
          prompt: "Test prompt",
          provider: "openai",
          model: "gpt-4.1-mini",
        },
        { "X-OpenAI-API-Key": "header-openai-key" }
      );

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);

      // Verify fetch was called with header key (takes precedence)
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.openai.com/v1/chat/completions",
        expect.objectContaining({
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer header-openai-key",
          },
        })
      );
    });

    it("should return 429 on rate limit errors", async () => {
      process.env.OPENAI_API_KEY = "test-openai-key";

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 429,
        json: () =>
          Promise.resolve({
            error: { message: "429 Rate limit exceeded" },
          }),
      });

      const request = createMockPostRequest({
        prompt: "Test prompt",
        provider: "openai",
        model: "gpt-4.1-mini",
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(429);
      expect(data.success).toBe(false);
      expect(data.error).toBe("Rate limit reached. Please wait and try again.");
    });

    it("should handle OpenAI API error responses", async () => {
      process.env.OPENAI_API_KEY = "test-openai-key";

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: () =>
          Promise.resolve({
            error: { message: "Invalid API key" },
          }),
      });

      const request = createMockPostRequest({
        prompt: "Test prompt",
        provider: "openai",
        model: "gpt-4.1-mini",
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.success).toBe(false);
      expect(data.error).toBe("Invalid API key");
    });

    it("should handle OpenAI API error without message", async () => {
      process.env.OPENAI_API_KEY = "test-openai-key";

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: () => Promise.resolve({}),
      });

      const request = createMockPostRequest({
        prompt: "Test prompt",
        provider: "openai",
        model: "gpt-4.1-mini",
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.success).toBe(false);
      expect(data.error).toBe("OpenAI API error: 500");
    });

    it("should handle no text in OpenAI response", async () => {
      process.env.OPENAI_API_KEY = "test-openai-key";

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            choices: [{ message: { content: null } }],
          }),
      });

      const request = createMockPostRequest({
        prompt: "Test prompt",
        provider: "openai",
        model: "gpt-4.1-mini",
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.success).toBe(false);
      expect(data.error).toBe("No text in OpenAI response");
    });
  });

  describe("Anthropic provider", () => {
    beforeEach(() => {
      global.fetch = mockFetch;
    });

    it("should generate text successfully with Anthropic", async () => {
      process.env.ANTHROPIC_API_KEY = "test-anthropic-key";

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            content: [{ type: "text", text: "Anthropic response text" }],
          }),
      });

      const request = createMockPostRequest({
        prompt: "Test prompt",
        provider: "anthropic",
        model: "claude-sonnet-4.5",
        temperature: 0.7,
        maxTokens: 1024,
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.text).toBe("Anthropic response text");

      // Verify fetch was called with correct parameters
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.anthropic.com/v1/messages",
        expect.objectContaining({
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": "test-anthropic-key",
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({
            model: "claude-sonnet-4-5-20250929",
            messages: [{ role: "user", content: [{ type: "text", text: "Test prompt" }] }],
            temperature: 0.7,
            max_tokens: 1024,
          }),
        })
      );
    });

    it("should handle multimodal input with Anthropic content block structure", async () => {
      process.env.ANTHROPIC_API_KEY = "test-anthropic-key";

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            content: [{ type: "text", text: "Image description from Claude" }],
          }),
      });

      const request = createMockPostRequest({
        prompt: "Describe this image",
        images: ["data:image/png;base64,iVBORw0KGgo="],
        provider: "anthropic",
        model: "claude-sonnet-4.5",
        temperature: 0.7,
        maxTokens: 1024,
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.text).toBe("Image description from Claude");

      // Verify Anthropic content block structure
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.anthropic.com/v1/messages",
        expect.objectContaining({
          body: JSON.stringify({
            model: "claude-sonnet-4-5-20250929",
            messages: [
              {
                role: "user",
                content: [
                  {
                    type: "image",
                    source: { type: "base64", media_type: "image/png", data: "iVBORw0KGgo=" },
                  },
                  { type: "text", text: "Describe this image" },
                ],
              },
            ],
            temperature: 0.7,
            max_tokens: 1024,
          }),
        })
      );
    });

    it("should reject missing Anthropic API key with typed byok error", async () => {
      delete process.env.ANTHROPIC_API_KEY;
      mockedResolveProviderKey.mockResolvedValue(null);

      const request = createMockPostRequest({
        prompt: "Test prompt",
        provider: "anthropic",
        model: "claude-sonnet-4.5",
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(response.status).toBeLessThan(500);
      expect(data.success).toBe(false);
      expect(data.code).toBe("byok_key_missing");
      expect(data.provider).toBe("anthropic");
      expect(data.error).toContain("Anthropic");
      expect(data.error).toContain("Provider Keys");
      expect(data.error).not.toMatch(/ANTHROPIC_API_KEY|process\.env/);
    });

    it("should use X-Anthropic-API-Key header over the vault", async () => {
      process.env.ANTHROPIC_API_KEY = "env-anthropic-key";

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            content: [{ type: "text", text: "Response with header key" }],
          }),
      });

      const request = createMockPostRequest(
        {
          prompt: "Test prompt",
          provider: "anthropic",
          model: "claude-sonnet-4.5",
        },
        { "X-Anthropic-API-Key": "header-anthropic-key" }
      );

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);

      // Verify fetch was called with header key (takes precedence)
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.anthropic.com/v1/messages",
        expect.objectContaining({
          headers: {
            "Content-Type": "application/json",
            "x-api-key": "header-anthropic-key",
            "anthropic-version": "2023-06-01",
          },
        })
      );
    });

    it("should return 429 on rate limit errors", async () => {
      process.env.ANTHROPIC_API_KEY = "test-anthropic-key";

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 429,
        json: () =>
          Promise.resolve({
            error: { message: "429 Rate limit exceeded" },
          }),
      });

      const request = createMockPostRequest({
        prompt: "Test prompt",
        provider: "anthropic",
        model: "claude-sonnet-4.5",
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(429);
      expect(data.success).toBe(false);
      expect(data.error).toBe("Rate limit reached. Please wait and try again.");
    });

    it("should handle Anthropic API error responses", async () => {
      process.env.ANTHROPIC_API_KEY = "test-anthropic-key";

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: () =>
          Promise.resolve({
            error: { message: "Invalid API key" },
          }),
      });

      const request = createMockPostRequest({
        prompt: "Test prompt",
        provider: "anthropic",
        model: "claude-sonnet-4.5",
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.success).toBe(false);
      expect(data.error).toBe("Invalid API key");
    });

    it("should handle no text in Anthropic response", async () => {
      process.env.ANTHROPIC_API_KEY = "test-anthropic-key";

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            content: [],
          }),
      });

      const request = createMockPostRequest({
        prompt: "Test prompt",
        provider: "anthropic",
        model: "claude-sonnet-4.5",
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.success).toBe(false);
      expect(data.error).toBe("No text in Anthropic response");
    });

    it("should handle image without data URL prefix", async () => {
      process.env.ANTHROPIC_API_KEY = "test-anthropic-key";

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            content: [{ type: "text", text: "Image description" }],
          }),
      });

      const request = createMockPostRequest({
        prompt: "Describe this",
        images: ["iVBORw0KGgoAAAANSUhEUgAAAAUA"],
        provider: "anthropic",
        model: "claude-sonnet-4.5",
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);

      // Verify fallback to PNG mime type
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.anthropic.com/v1/messages",
        expect.objectContaining({
          body: JSON.stringify({
            model: "claude-sonnet-4-5-20250929",
            messages: [
              {
                role: "user",
                content: [
                  {
                    type: "image",
                    source: { type: "base64", media_type: "image/png", data: "iVBORw0KGgoAAAANSUhEUgAAAAUA" },
                  },
                  { type: "text", text: "Describe this" },
                ],
              },
            ],
            temperature: 0.7,
            max_tokens: 1024,
          }),
        })
      );
    });
  });
});
