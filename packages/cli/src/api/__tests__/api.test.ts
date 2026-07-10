import { describe, expect, it, vi } from "vitest";

import { ApiError } from "../../errors/errors";
import { createApiClient } from "../client";

interface Captured {
  url: string;
  headers: Record<string, string>;
}

function fakeFetch(
  body: unknown,
  init: { status?: number } = {},
): { fetch: typeof fetch; calls: Captured[] } {
  const calls: Captured[] = [];
  const impl = (async (input: string | URL | Request, options?: RequestInit) => {
    const headers = new Headers(options?.headers);
    const record: Record<string, string> = {};
    headers.forEach((value, key) => {
      record[key] = value;
    });
    calls.push({ url: String(input), headers: record });
    return new Response(JSON.stringify(body), {
      status: init.status ?? 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return { fetch: impl, calls };
}

const WORKSPACE = { id: "ws_1", name: "Acme", slug: "acme" };

describe("createApiClient", () => {
  it("sends a bearer token to the workspaces endpoint and returns the list", async () => {
    const { fetch, calls } = fakeFetch({ success: true, workspaces: [WORKSPACE] });
    const client = createApiClient({
      token: "nb_secret",
      url: "https://api.example.com",
      fetchImpl: fetch,
    });

    const workspaces = await client.listWorkspaces();

    expect(workspaces).toEqual([WORKSPACE]);
    expect(calls[0]?.url).toBe("https://api.example.com/api/v1/workspaces");
    expect(calls[0]?.headers.authorization).toBe("Bearer nb_secret");
  });

  it("strips a trailing slash from the base url", async () => {
    const { fetch, calls } = fakeFetch({ success: true, workspaces: [] });
    const client = createApiClient({
      token: "nb_secret",
      url: "https://api.example.com/",
      fetchImpl: fetch,
    });

    await client.listWorkspaces();

    expect(calls[0]?.url).toBe("https://api.example.com/api/v1/workspaces");
  });

  it("forwards type and limit query params for assets", async () => {
    const { fetch, calls } = fakeFetch({ success: true, assets: [] });
    const client = createApiClient({
      token: "nb_secret",
      url: "https://api.example.com",
      fetchImpl: fetch,
    });

    await client.listAssets({ type: "image", limit: 10 });

    expect(calls[0]?.url).toBe(
      "https://api.example.com/api/v1/assets?type=image&limit=10",
    );
  });

  it("returns social accounts from the registry-backed route", async () => {
    const account = {
      id: "acc_1",
      platform: "x",
      platformUserId: "123",
      displayName: "Acme",
      username: "acme",
      avatarUrl: null,
      tokenExpiresAt: null,
      requiresReauth: false,
      disabled: false,
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    const { fetch } = fakeFetch({ success: true, accounts: [account] });
    const client = createApiClient({
      token: "nb_secret",
      url: "https://api.example.com",
      fetchImpl: fetch,
    });

    expect(await client.listSocialAccounts()).toEqual([account]);
  });

  it("throws a structured ApiError for a registry-style error body", async () => {
    const { fetch } = fakeFetch(
      {
        success: false,
        error: {
          code: "forbidden",
          message: "This token cannot access this resource.",
          fix: "Use a token whose role grants social:view.",
        },
      },
      { status: 403 },
    );
    const client = createApiClient({
      token: "nb_secret",
      url: "https://api.example.com",
      fetchImpl: fetch,
    });

    const error = await client.listSocialAccounts().catch((e) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error.code).toBe("forbidden");
    expect(error.fix).toBe("Use a token whose role grants social:view.");
  });

  it("throws an ApiError carrying the plain string error from /workspaces", async () => {
    const { fetch } = fakeFetch(
      { success: false, error: "Invalid or revoked API token." },
      { status: 401 },
    );
    const client = createApiClient({
      token: "nb_bad",
      url: "https://api.example.com",
      fetchImpl: fetch,
    });

    const error = await client.listWorkspaces().catch((e) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error.message).toBe("Invalid or revoked API token.");
    expect(error.code).toBeUndefined();
  });

  it("wraps a network failure as an ApiError with a fix", async () => {
    const impl = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    const client = createApiClient({
      token: "nb_secret",
      url: "https://api.example.com",
      fetchImpl: impl,
    });

    const error = await client.listWorkspaces().catch((e) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error.message).toContain("https://api.example.com");
    expect(error.fix).toBeTruthy();
  });

  it("rejects a response whose payload violates the schema", async () => {
    const { fetch } = fakeFetch({
      success: true,
      workspaces: [{ id: "ws_1" }],
    });
    const client = createApiClient({
      token: "nb_secret",
      url: "https://api.example.com",
      fetchImpl: fetch,
    });

    const error = await client.listWorkspaces().catch((e) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error.code).toBe("invalid_response");
  });

  it("verifyToken resolves when the token can list workspaces", async () => {
    const { fetch } = fakeFetch({ success: true, workspaces: [WORKSPACE] });
    const client = createApiClient({
      token: "nb_secret",
      url: "https://api.example.com",
      fetchImpl: fetch,
    });

    await expect(client.verifyToken()).resolves.toBeUndefined();
  });
});
