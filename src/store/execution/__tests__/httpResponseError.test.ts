import { describe, it, expect, vi } from "vitest";
import { throwIfResponseError } from "../httpResponseError";

function makeResponse(
  ok: boolean,
  status: number,
  body: string,
): Response {
  return {
    ok,
    status,
    text: () => Promise.resolve(body),
  } as unknown as Response;
}

describe("throwIfResponseError", () => {
  it("resolves without calling updateNodeData when response.ok is true", async () => {
    const updateNodeData = vi.fn();
    const response = makeResponse(true, 200, "");

    await expect(
      throwIfResponseError(response, "node-1", updateNodeData),
    ).resolves.toBeUndefined();

    expect(updateNodeData).not.toHaveBeenCalled();
  });

  it("throws with JSON error message and marks node errored on 500", async () => {
    const updateNodeData = vi.fn();
    const response = makeResponse(false, 500, '{"error": "boom"}');

    await expect(
      throwIfResponseError(response, "node-1", updateNodeData),
    ).rejects.toThrow("boom");

    expect(updateNodeData).toHaveBeenCalledWith("node-1", {
      status: "error",
      error: "boom",
    });
  });

  it("throws with truncated text fallback on non-JSON 502 body", async () => {
    const updateNodeData = vi.fn();
    const longBody = "x".repeat(300);
    const response = makeResponse(false, 502, longBody);

    await expect(
      throwIfResponseError(response, "node-2", updateNodeData),
    ).rejects.toThrow(`HTTP 502 - ${"x".repeat(200)}`);

    expect(updateNodeData).toHaveBeenCalledWith("node-2", {
      status: "error",
      error: `HTTP 502 - ${"x".repeat(200)}`,
    });
  });

  it("surfaces the typed BYOK key-missing message to the node on 401", async () => {
    // Mirrors the generate/LLM routes' byok_key_missing 401 body. The existing
    // node error-display path must show the provider-named message verbatim and
    // never a leaked server env var name.
    const updateNodeData = vi.fn();
    const body = JSON.stringify({
      success: false,
      error:
        "No Google Gemini API key is configured for this workspace. Add one in Settings → Provider Keys.",
      code: "byok_key_missing",
      provider: "gemini",
      remedy: "Add a Google Gemini key in Settings → Provider Keys.",
    });
    const response = makeResponse(false, 401, body);

    await expect(
      throwIfResponseError(response, "node-byok", updateNodeData),
    ).rejects.toThrow(/Provider Keys/);

    expect(updateNodeData).toHaveBeenCalledWith("node-byok", {
      status: "error",
      error:
        "No Google Gemini API key is configured for this workspace. Add one in Settings → Provider Keys.",
    });
    const surfaced = updateNodeData.mock.calls[0][1].error as string;
    expect(surfaced).toContain("Google Gemini");
    expect(surfaced).not.toMatch(/GEMINI_API_KEY|process\.env/);
  });

  it("throws 'HTTP 404' with no suffix when body is empty on 404", async () => {
    const updateNodeData = vi.fn();
    const response = makeResponse(false, 404, "");

    await expect(
      throwIfResponseError(response, "node-3", updateNodeData),
    ).rejects.toThrow("HTTP 404");

    expect(updateNodeData).toHaveBeenCalledWith("node-3", {
      status: "error",
      error: "HTTP 404",
    });
  });
});
