import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createApiTokenRequest,
  listApiTokensRequest,
  revokeApiTokenRequest,
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

describe("api-tokens client", () => {
  beforeEach(() => {
    setActiveWorkspaceId("ws_1");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    setActiveWorkspaceId(null);
  });

  it("lists tokens from GET /api/tokens with the workspace header", async () => {
    const fetchMock = mockFetchOnce(200, {
      success: true,
      tokens: [
        {
          id: "apitok_1",
          name: "CI",
          prefix: "nb_abc",
          revoked: false,
          lastUsedAt: null,
          createdAt: "2026-07-10T00:00:00.000Z",
        },
      ],
    });

    const tokens = await listApiTokensRequest();

    expect(tokens).toHaveLength(1);
    expect(tokens[0].name).toBe("CI");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/tokens");
    expect(new Headers(init.headers).get("x-workspace-id")).toBe("ws_1");
  });

  it("creates a token via POST and returns the raw secret", async () => {
    const fetchMock = mockFetchOnce(201, {
      success: true,
      token: {
        id: "apitok_1",
        name: "CI",
        token: "nb_rawsecret",
        prefix: "nb_rawse",
        createdAt: "2026-07-10T00:00:00.000Z",
      },
    });

    const created = await createApiTokenRequest("CI");

    expect(created.token).toBe("nb_rawsecret");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/tokens");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ name: "CI" });
  });

  it("revokes a token via DELETE to the id-scoped path", async () => {
    const fetchMock = mockFetchOnce(200, { success: true });

    await revokeApiTokenRequest("apitok_1");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/tokens/apitok_1");
    expect(init.method).toBe("DELETE");
  });
});
