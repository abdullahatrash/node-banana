import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ApiClient } from "../../api/client";
import type { Asset, SocialAccount, Workspace } from "../../api/schemas";
import { UsageError } from "../../errors/errors";
import { authLogin, authStatus } from "../auth";
import { accountsList } from "../accounts";
import { assetsList } from "../assets";
import { resolveClient, type AppDeps } from "../context";
import { workspacesList } from "../workspaces";

const WORKSPACE: Workspace = { id: "ws_1", name: "Acme", slug: "acme" };
const ACCOUNT: SocialAccount = {
  id: "acc_1",
  platform: "x",
  platformUserId: "123",
  displayName: "Acme Co",
  username: "acme",
  avatarUrl: null,
  tokenExpiresAt: null,
  requiresReauth: false,
  disabled: false,
  createdAt: "2026-01-01T00:00:00.000Z",
};
const ASSET: Asset = {
  id: "asset_1",
  projectId: null,
  type: "image",
  mimeType: "image/png",
  sizeBytes: 2048,
  width: 100,
  height: 100,
  durationSeconds: null,
  createdAt: "2026-01-02T00:00:00.000Z",
};

function makeDeps(overrides: Partial<AppDeps> = {}): {
  deps: AppDeps;
  out: string[];
  err: string[];
  client: ApiClient;
  created: Array<{ token: string; url: string }>;
} {
  const out: string[] = [];
  const err: string[] = [];
  const created: Array<{ token: string; url: string }> = [];

  const client: ApiClient = {
    listWorkspaces: vi.fn(async () => [WORKSPACE]),
    listSocialAccounts: vi.fn(async () => [ACCOUNT]),
    listAssets: vi.fn(async () => [ASSET]),
    verifyToken: vi.fn(async () => undefined),
  };

  const deps: AppDeps = {
    loadConfig: vi.fn(() => ({ token: "nb_secret", url: "https://api.example.com" })),
    saveConfig: vi.fn(),
    clearConfig: vi.fn(),
    createClient: vi.fn((options) => {
      created.push({ token: options.token, url: options.url });
      return client;
    }),
    promptSecret: vi.fn(async () => "nb_prompted"),
    io: { out: (line) => out.push(line), err: (line) => err.push(line) },
    ...overrides,
  };

  return { deps, out, err, client, created };
}

describe("resolveClient", () => {
  it("throws a UsageError when there is no stored config", () => {
    const { deps } = makeDeps({ loadConfig: () => null });
    expect(() => resolveClient(deps)).toThrow(UsageError);
  });

  it("builds a client from the stored token and url", () => {
    const { deps, created } = makeDeps();
    resolveClient(deps);
    expect(created[0]).toEqual({ token: "nb_secret", url: "https://api.example.com" });
  });
});

describe("workspaces list", () => {
  it("prints a human table by default", async () => {
    const { deps, out } = makeDeps();
    await workspacesList(deps, { json: false });
    const text = out.join("\n");
    expect(text).toContain("ID");
    expect(text).toContain("ws_1");
    expect(text).toContain("Acme");
    expect(text).toContain("acme");
  });

  it("prints exact JSON data with --json", async () => {
    const { deps, out } = makeDeps();
    await workspacesList(deps, { json: true });
    expect(JSON.parse(out.join("\n"))).toEqual([WORKSPACE]);
  });

  it("shows an empty-state message when there are no workspaces", async () => {
    const { deps, out, client } = makeDeps();
    (client.listWorkspaces as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    await workspacesList(deps, { json: false });
    expect(out.join("\n").toLowerCase()).toContain("no workspaces");
  });
});

describe("accounts list", () => {
  it("prints a human table including platform and username", async () => {
    const { deps, out } = makeDeps();
    await accountsList(deps, { json: false });
    const text = out.join("\n");
    expect(text).toContain("acc_1");
    expect(text).toContain("x");
    expect(text).toContain("acme");
  });

  it("prints exact JSON data with --json", async () => {
    const { deps, out } = makeDeps();
    await accountsList(deps, { json: true });
    expect(JSON.parse(out.join("\n"))).toEqual([ACCOUNT]);
  });
});

describe("assets list", () => {
  it("forwards type and limit filters to the client", async () => {
    const { deps, client } = makeDeps();
    await assetsList(deps, { json: false, type: "image", limit: 5 });
    expect(client.listAssets).toHaveBeenCalledWith({ type: "image", limit: 5 });
  });

  it("prints exact JSON data with --json", async () => {
    const { deps, out } = makeDeps();
    await assetsList(deps, { json: true });
    expect(JSON.parse(out.join("\n"))).toEqual([ASSET]);
  });
});

describe("auth login", () => {
  it("verifies and stores a token passed via --token", async () => {
    const { deps, out } = makeDeps({ loadConfig: () => null });
    await authLogin(deps, {
      token: "nb_new",
      url: "https://app.example.com",
      json: false,
    });

    expect(deps.createClient).toHaveBeenCalledWith(
      expect.objectContaining({ token: "nb_new", url: "https://app.example.com" }),
    );
    expect(deps.saveConfig).toHaveBeenCalledWith({
      token: "nb_new",
      url: "https://app.example.com",
    });
    expect(out.join("\n").toLowerCase()).toContain("logged in");
  });

  it("prompts for the token when --token is omitted", async () => {
    const { deps } = makeDeps({ loadConfig: () => null });
    await authLogin(deps, { url: "https://app.example.com", json: false });

    expect(deps.promptSecret).toHaveBeenCalled();
    expect(deps.saveConfig).toHaveBeenCalledWith({
      token: "nb_prompted",
      url: "https://app.example.com",
    });
  });

  it("does not persist a token the API rejects", async () => {
    const { deps, client } = makeDeps({ loadConfig: () => null });
    (client.verifyToken as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("Invalid or revoked API token."),
    );

    await expect(
      authLogin(deps, { token: "nb_bad", url: "https://app.example.com", json: false }),
    ).rejects.toThrow();
    expect(deps.saveConfig).not.toHaveBeenCalled();
  });

  it("emits machine-readable json on success", async () => {
    const { deps, out } = makeDeps({ loadConfig: () => null });
    await authLogin(deps, {
      token: "nb_new",
      url: "https://app.example.com",
      json: true,
    });
    expect(JSON.parse(out.join("\n"))).toEqual({
      authenticated: true,
      url: "https://app.example.com",
    });
  });
});

describe("auth status", () => {
  it("reports the authenticated url and a masked token", async () => {
    const { deps, out } = makeDeps();
    await authStatus(deps, { json: false });
    const text = out.join("\n");
    expect(text.toLowerCase()).toContain("https://api.example.com");
    // The raw token must never be printed in full.
    expect(text).not.toContain("nb_secret");
  });

  it("reports not-authenticated as json when no config exists", async () => {
    const { deps, out } = makeDeps({ loadConfig: () => null });
    await authStatus(deps, { json: true });
    expect(JSON.parse(out.join("\n"))).toEqual({
      authenticated: false,
      url: null,
    });
  });
});
