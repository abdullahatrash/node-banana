import { describe, expect, it, vi } from "vitest";

import type { ApiClient } from "../api/client";
import type { AppDeps } from "../commands/context";
import { buildProgram } from "../program";

function makeDeps(): { deps: AppDeps; out: string[]; client: ApiClient } {
  const out: string[] = [];
  const client: ApiClient = {
    listWorkspaces: vi.fn(async () => [{ id: "ws_1", name: "Acme", slug: "acme" }]),
    listSocialAccounts: vi.fn(async () => []),
    listAssets: vi.fn(async () => []),
    uploadAsset: vi.fn(async () => ({
      assetId: "asset_new",
      downloadUrl: "https://cdn.example/asset_new.png",
      expiresInSeconds: null,
    })),
    getAssetDownloadUrl: vi.fn(async () => ({
      assetId: "asset_1",
      downloadUrl: "https://signed.example/asset_1.png",
      expiresInSeconds: 900,
    })),
    runWorkflow: vi.fn(async () => ({ runId: "run_1", status: "queued" })),
    getRunStatus: vi.fn(async () => ({
      runId: "run_1",
      status: "succeeded",
      progress: { nodes: [] },
      outputs: [],
      error: null,
    })),
    createPost: vi.fn(async () => ({
      postId: "spost_new",
      status: "queued",
      scheduledAt: "2026-07-10T15:00:00.000Z",
    })),
    listPosts: vi.fn(async () => []),
    getPostStatus: vi.fn(async () => ({
      postId: "spost_1",
      socialAccountId: "acc_1",
      status: "published",
      dispatchStatus: "dispatched",
      dispatchAttempts: 1,
      retryCount: 0,
      scheduledAt: null,
      publishedAt: "2026-07-10T15:00:05.000Z",
      nextDispatchAt: null,
      lastError: null,
      platformPostId: "tweet_1",
      releaseUrl: "https://x.com/acme/status/1",
      createdAt: "2026-07-10T14:00:00.000Z",
      updatedAt: "2026-07-10T15:00:05.000Z",
    })),
    verifyToken: vi.fn(async () => undefined),
  };
  const deps: AppDeps = {
    loadConfig: () => ({ token: "nb_secret", url: "https://api.example.com" }),
    saveConfig: vi.fn(),
    clearConfig: vi.fn(),
    createClient: vi.fn(() => client),
    promptSecret: vi.fn(async () => "nb_prompted"),
    readFile: vi.fn(() => Buffer.from("file-bytes")),
    sleep: vi.fn(async () => undefined),
    io: { out: (line) => out.push(line), err: () => {} },
  };
  return { deps, out, client };
}

async function run(deps: AppDeps, argv: string[]): Promise<void> {
  const program = buildProgram(deps);
  program.exitOverride();
  await program.parseAsync(argv, { from: "user" });
}

describe("buildProgram", () => {
  it("names the binary nb and registers the top-level commands", () => {
    const { deps } = makeDeps();
    const program = buildProgram(deps);
    expect(program.name()).toBe("nb");
    const names = program.commands.map((c) => c.name()).sort();
    expect(names).toEqual([
      "accounts",
      "assets",
      "auth",
      "post",
      "run",
      "runs",
      "workspaces",
    ]);
  });

  it("runs `workspaces list` and prints a table", async () => {
    const { deps, out } = makeDeps();
    await run(deps, ["workspaces", "list"]);
    expect(out.join("\n")).toContain("ws_1");
  });

  it("honours a global --json flag placed before the subcommand", async () => {
    const { deps, out } = makeDeps();
    await run(deps, ["--json", "workspaces", "list"]);
    expect(JSON.parse(out.join("\n"))).toEqual([
      { id: "ws_1", name: "Acme", slug: "acme" },
    ]);
  });

  it("honours a --json flag placed after the subcommand", async () => {
    const { deps, out } = makeDeps();
    await run(deps, ["workspaces", "list", "--json"]);
    expect(JSON.parse(out.join("\n"))).toEqual([
      { id: "ws_1", name: "Acme", slug: "acme" },
    ]);
  });

  it("wires auth status through the program", async () => {
    const { deps, out } = makeDeps();
    await run(deps, ["auth", "status"]);
    expect(out.join("\n").toLowerCase()).toContain("https://api.example.com");
  });

  it("runs `assets upload` and prints the asset id and download url", async () => {
    const { deps, out } = makeDeps();
    await run(deps, ["assets", "upload", "/tmp/photo.png"]);
    const text = out.join("\n");
    expect(text).toContain("asset_new");
    expect(text).toContain("https://cdn.example/asset_new.png");
  });

  it("runs `assets upload --json` with an explicit --type", async () => {
    const { deps, out, client } = makeDeps();
    await run(deps, ["assets", "upload", "/tmp/blob.bin", "--type", "video", "--json"]);
    expect(client.uploadAsset).toHaveBeenCalledWith(
      expect.objectContaining({ assetType: "video" }),
    );
    expect(JSON.parse(out.join("\n"))).toEqual({
      assetId: "asset_new",
      downloadUrl: "https://cdn.example/asset_new.png",
      expiresInSeconds: null,
    });
  });

  it("runs `assets download-url` and prints the url", async () => {
    const { deps, out } = makeDeps();
    await run(deps, ["assets", "download-url", "asset_1"]);
    expect(out.join("\n")).toContain("https://signed.example/asset_1.png");
  });

  it("runs `post create` with --account and --text, defaulting to a draft", async () => {
    const { deps, client } = makeDeps();
    await run(deps, ["post", "create", "--account", "acc_1", "--text", "Hello"]);
    expect(client.createPost).toHaveBeenCalledWith({
      socialAccountId: "acc_1",
      content: "Hello",
      draft: true,
    });
  });

  it("runs `post create` with variadic --media and an ISO --schedule", async () => {
    const { deps, client } = makeDeps();
    await run(deps, [
      "post",
      "create",
      "--account",
      "acc_1",
      "--text",
      "Hi",
      "--media",
      "asset_1",
      "asset_2",
      "--schedule",
      "2026-07-10T15:00:00.000Z",
    ]);
    expect(client.createPost).toHaveBeenCalledWith({
      socialAccountId: "acc_1",
      content: "Hi",
      mediaAssetIds: ["asset_1", "asset_2"],
      scheduledAt: "2026-07-10T15:00:00.000Z",
    });
  });

  it("runs `post status <id> --json`", async () => {
    const { deps, out } = makeDeps();
    await run(deps, ["post", "status", "spost_1", "--json"]);
    expect(JSON.parse(out.join("\n")).releaseUrl).toBe(
      "https://x.com/acme/status/1",
    );
  });
});
