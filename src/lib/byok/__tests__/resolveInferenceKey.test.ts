import { describe, it, expect, vi, beforeEach } from "vitest";

// The vault tier delegates to the repository's resolveProviderKey. Mock it so
// these tests never touch the database and can drive header/vault/miss cases.
vi.mock("../repository", () => ({
  resolveProviderKey: vi.fn(),
}));

import { resolveProviderKey } from "../repository";
import {
  resolveInferenceKey,
  InferenceKeyError,
  isInferenceKeyError,
} from "../resolveInferenceKey";

const mockedResolve = vi.mocked(resolveProviderKey);

describe("resolveInferenceKey", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the request header key, taking precedence over the vault", async () => {
    mockedResolve.mockResolvedValue("vault-key");

    const key = await resolveInferenceKey({
      headerKey: "header-key",
      workspaceId: "ws-1",
      provider: "gemini",
    });

    expect(key).toBe("header-key");
    // Header wins outright — the vault must not even be consulted.
    expect(mockedResolve).not.toHaveBeenCalled();
  });

  it("falls back to the workspace vault when no header is provided", async () => {
    mockedResolve.mockResolvedValue("vault-key");

    const key = await resolveInferenceKey({
      headerKey: null,
      workspaceId: "ws-1",
      provider: "openai",
    });

    expect(key).toBe("vault-key");
    expect(mockedResolve).toHaveBeenCalledWith("ws-1", "openai");
  });

  it("treats a blank/whitespace header as absent and falls through to the vault", async () => {
    mockedResolve.mockResolvedValue("vault-key");

    const key = await resolveInferenceKey({
      headerKey: "   ",
      workspaceId: "ws-1",
      provider: "anthropic",
    });

    expect(key).toBe("vault-key");
    expect(mockedResolve).toHaveBeenCalledWith("ws-1", "anthropic");
  });

  it("throws a typed byok_key_missing error when neither header nor vault has a key", async () => {
    mockedResolve.mockResolvedValue(null);

    await expect(
      resolveInferenceKey({
        headerKey: null,
        workspaceId: "ws-1",
        provider: "gemini",
      }),
    ).rejects.toBeInstanceOf(InferenceKeyError);
  });

  it("throws without consulting the vault when there is no workspace context (header-only tier)", async () => {
    await expect(
      resolveInferenceKey({
        headerKey: null,
        workspaceId: null,
        provider: "kie",
      }),
    ).rejects.toBeInstanceOf(InferenceKeyError);

    expect(mockedResolve).not.toHaveBeenCalled();
  });

  it("produces a structured error naming the provider and pointing to Settings → Provider Keys", async () => {
    mockedResolve.mockResolvedValue(null);

    let caught: unknown;
    try {
      await resolveInferenceKey({
        headerKey: null,
        workspaceId: "ws-1",
        provider: "replicate",
      });
    } catch (err) {
      caught = err;
    }

    expect(isInferenceKeyError(caught)).toBe(true);
    const error = caught as InferenceKeyError;
    expect(error.code).toBe("byok_key_missing");
    expect(error.provider).toBe("replicate");
    // Names the provider by human label, not the internal id.
    expect(error.message).toContain("Replicate");
    expect(error.message).toContain("Provider Keys");
    expect(error.remedy).toContain("Provider Keys");

    const body = error.toJSON();
    expect(body).toMatchObject({
      code: "byok_key_missing",
      provider: "replicate",
    });
    expect(typeof body.message).toBe("string");
    expect(typeof body.remedy).toBe("string");
  });

  it("never leaks the server env var name in the error message", async () => {
    mockedResolve.mockResolvedValue(null);

    for (const provider of ["gemini", "openai", "anthropic", "wavespeed"] as const) {
      const error = await resolveInferenceKey({
        headerKey: null,
        workspaceId: "ws-1",
        provider,
      }).catch((e) => e as InferenceKeyError);

      expect(error.message).not.toMatch(/API_KEY|process\.env|_KEY|env/i);
      expect(error.remedy).not.toMatch(/API_KEY|process\.env|_KEY/i);
    }
  });
});
