import { afterEach, describe, expect, it, vi } from "vitest";
import { validateProviderKey } from "../validation";

function mockFetchOnce(status: number, body: unknown) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("validateProviderKey", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("accepts a valid gemini key via the models list endpoint", async () => {
    const fetchMock = mockFetchOnce(200, { models: [] });

    const result = await validateProviderKey("gemini", "AIzaSyTestKey1234567890");

    expect(result).toEqual({ ok: true });
    const [url] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("generativelanguage.googleapis.com/v1beta/models");
    expect(String(url)).toContain("key=AIzaSyTestKey1234567890");
  });

  it("surfaces the Google error message for an invalid gemini key", async () => {
    mockFetchOnce(400, {
      error: { message: "API key not valid. Please pass a valid API key." },
    });

    const result = await validateProviderKey("gemini", "bad-key");

    expect(result).toEqual({
      ok: false,
      error: "API key not valid. Please pass a valid API key.",
    });
  });

  it("accepts a valid openai key via GET /v1/models with a bearer token", async () => {
    const fetchMock = mockFetchOnce(200, { data: [] });

    const result = await validateProviderKey("openai", "sk-openai-test");

    expect(result).toEqual({ ok: true });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.openai.com/v1/models");
    expect(new Headers(init.headers).get("authorization")).toBe(
      "Bearer sk-openai-test",
    );
  });

  it("surfaces the OpenAI error message for an invalid key", async () => {
    mockFetchOnce(401, {
      error: { message: "Incorrect API key provided.", type: "invalid_request_error" },
    });

    const result = await validateProviderKey("openai", "sk-bad");

    expect(result).toEqual({ ok: false, error: "Incorrect API key provided." });
  });

  it("accepts a valid anthropic key via GET /v1/models with x-api-key", async () => {
    const fetchMock = mockFetchOnce(200, { data: [] });

    const result = await validateProviderKey("anthropic", "ak-anthropic-test");

    expect(result).toEqual({ ok: true });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.anthropic.com/v1/models");
    const headers = new Headers(init.headers);
    expect(headers.get("x-api-key")).toBe("ak-anthropic-test");
    expect(headers.get("anthropic-version")).toBe("2023-06-01");
  });

  it("surfaces the Anthropic error message for an invalid key", async () => {
    mockFetchOnce(401, {
      type: "error",
      error: { type: "authentication_error", message: "invalid x-api-key" },
    });

    const result = await validateProviderKey("anthropic", "ak-bad");

    expect(result).toEqual({ ok: false, error: "invalid x-api-key" });
  });

  it("accepts a valid kie key via the credits endpoint", async () => {
    const fetchMock = mockFetchOnce(200, { code: 200, msg: "success", data: 100 });

    const result = await validateProviderKey("kie", "kie-test-key");

    expect(result).toEqual({ ok: true });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.kie.ai/api/v1/chat/credit");
    expect(new Headers(init.headers).get("authorization")).toBe(
      "Bearer kie-test-key",
    );
  });

  it("surfaces the Kie error message for an invalid key", async () => {
    mockFetchOnce(401, {
      code: 401,
      msg: "Unauthorized - Authentication credentials are missing or invalid",
      data: null,
    });

    const result = await validateProviderKey("kie", "kie-bad");

    expect(result).toEqual({
      ok: false,
      error: "Unauthorized - Authentication credentials are missing or invalid",
    });
  });

  it("accepts a valid fal key via the models endpoint", async () => {
    const fetchMock = mockFetchOnce(200, { items: [] });

    const result = await validateProviderKey("fal", "fal-test-key");

    expect(result).toEqual({ ok: true });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("https://api.fal.ai/v1/models");
    expect(new Headers(init.headers).get("authorization")).toBe(
      "Key fal-test-key",
    );
  });

  it("surfaces a fal error message for an invalid key", async () => {
    mockFetchOnce(401, { detail: "Invalid API key" });

    const result = await validateProviderKey("fal", "fal-bad");

    expect(result).toEqual({ ok: false, error: "Invalid API key" });
  });

  it("accepts a valid replicate key via the account endpoint", async () => {
    const fetchMock = mockFetchOnce(200, { type: "user", username: "acme" });

    const result = await validateProviderKey("replicate", "r8_test");

    expect(result).toEqual({ ok: true });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.replicate.com/v1/account");
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer r8_test");
  });

  it("surfaces a replicate error message for an invalid key", async () => {
    mockFetchOnce(401, { detail: "Invalid token." });

    const result = await validateProviderKey("replicate", "r8_bad");

    expect(result).toEqual({ ok: false, error: "Invalid token." });
  });

  it("accepts a valid wavespeed key via the balance endpoint", async () => {
    const fetchMock = mockFetchOnce(200, {
      code: 200,
      message: "success",
      data: { balance: 50.25 },
    });

    const result = await validateProviderKey("wavespeed", "ws-test-key");

    expect(result).toEqual({ ok: true });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.wavespeed.ai/api/v3/balance");
    expect(new Headers(init.headers).get("authorization")).toBe(
      "Bearer ws-test-key",
    );
  });

  it("surfaces a wavespeed error message for an invalid key", async () => {
    mockFetchOnce(401, { code: 401, message: "Unauthorized" });

    const result = await validateProviderKey("wavespeed", "ws-bad");

    expect(result).toEqual({ ok: false, error: "Unauthorized" });
  });

  it("rejects an empty key without making a network call", async () => {
    const fetchMock = mockFetchOnce(200, {});

    const result = await validateProviderKey("openai", "   ");

    expect(result.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns a clear error when the network call itself fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("fetch failed: ECONNREFUSED")),
    );

    const result = await validateProviderKey("openai", "sk-test");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/could not reach openai/i);
    }
  });
});
