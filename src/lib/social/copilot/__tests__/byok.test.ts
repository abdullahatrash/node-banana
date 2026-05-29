import { describe, it, expect } from "vitest";
import { resolveCopilotModel } from "../byok";

describe("resolveCopilotModel", () => {
  it("resolves the default Sonnet 4.6 model from an Anthropic key", () => {
    const headers = new Headers({ "X-Anthropic-API-Key": "ak-123" });

    const result = resolveCopilotModel(headers);

    expect(result).toEqual({
      ok: true,
      provider: "anthropic",
      modelId: "claude-sonnet-4-6",
      apiKey: "ak-123",
    });
  });

  it("returns an error prompting Settings when the required key is absent (no env fallback)", () => {
    const result = resolveCopilotModel(new Headers());

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/settings/i);
    }
  });

  it("resolves a requested Gemini model from the Gemini key", () => {
    const headers = new Headers({ "X-Gemini-API-Key": "gk-123" });

    const result = resolveCopilotModel(headers, "gemini-3-pro-preview");

    expect(result).toEqual({
      ok: true,
      provider: "google",
      modelId: "gemini-3-pro-preview",
      apiKey: "gk-123",
    });
  });

  it("errors when the requested model's provider key is missing", () => {
    const headers = new Headers({ "X-Anthropic-API-Key": "ak-123" });

    const result = resolveCopilotModel(headers, "gemini-3-pro-preview");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/settings/i);
    }
  });
});
