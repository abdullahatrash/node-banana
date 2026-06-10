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
