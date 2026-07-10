import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  deleteProviderKeyRequest,
  listProviderKeysRequest,
  saveProviderKeyRequest,
} from "../client";
import { setActiveWorkspaceId } from "@/lib/studio/client";

function mockFetchOnce(status: number, body: unknown) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("byok client", () => {
  beforeEach(() => {
    setActiveWorkspaceId("ws_1");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    setActiveWorkspaceId(null);
  });

  it("lists provider keys from GET /api/keys with the workspace header", async () => {
    const fetchMock = mockFetchOnce(200, {
      success: true,
      keys: [
        {
          provider: "openai",
          hint: "sk-…test",
          lastValidatedAt: "2026-07-10T00:00:00.000Z",
          updatedAt: "2026-07-10T00:00:00.000Z",
        },
      ],
    });

    const keys = await listProviderKeysRequest();

    expect(keys).toHaveLength(1);
    expect(keys[0].provider).toBe("openai");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/keys");
    expect(new Headers(init.headers).get("x-workspace-id")).toBe("ws_1");
  });

  it("saves a provider key via POST and returns the masked summary", async () => {
    const fetchMock = mockFetchOnce(200, {
      success: true,
      key: {
        provider: "openai",
        hint: "sk-…test",
        lastValidatedAt: "2026-07-10T00:00:00.000Z",
        updatedAt: "2026-07-10T00:00:00.000Z",
      },
    });

    const saved = await saveProviderKeyRequest("openai", "sk-realsecret");

    expect(saved.hint).toBe("sk-…test");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/keys");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({
      provider: "openai",
      apiKey: "sk-realsecret",
    });
  });

  it("surfaces the provider's validation error on save failure", async () => {
    mockFetchOnce(422, {
      success: false,
      error: "Incorrect API key provided.",
    });

    await expect(saveProviderKeyRequest("openai", "sk-bad")).rejects.toThrow(
      "Incorrect API key provided.",
    );
  });

  it("deletes a provider key via DELETE to the provider-scoped path", async () => {
    const fetchMock = mockFetchOnce(200, { success: true });

    await deleteProviderKeyRequest("anthropic");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/keys/anthropic");
    expect(init.method).toBe("DELETE");
  });
});
