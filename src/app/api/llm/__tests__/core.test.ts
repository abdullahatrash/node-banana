import { describe, expect, it, vi } from "vitest";

const { mockGenerateContent } = vi.hoisted(() => ({
  mockGenerateContent: vi.fn(),
}));

vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    models = { generateContent: mockGenerateContent };
    constructor(_config: { apiKey: string }) {}
  },
}));

vi.mock("@/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { generateLlmText } from "../core";

describe("generateLlmText", () => {
  it("dispatches to Google and returns the generated text", async () => {
    mockGenerateContent.mockResolvedValue({ text: "hello world" });

    const text = await generateLlmText({
      provider: "google",
      model: "gemini-2.5-flash",
      prompt: "hi",
      keys: { google: "gkey" },
    });

    expect(text).toBe("hello world");
    expect(mockGenerateContent).toHaveBeenCalledOnce();
  });

  it("throws on an unknown provider", async () => {
    await expect(
      generateLlmText({ provider: "mystery", model: "gemini-2.5-flash", prompt: "hi" }),
    ).rejects.toThrow(/Unknown provider/);
  });
});
