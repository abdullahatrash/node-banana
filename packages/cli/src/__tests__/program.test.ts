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
    verifyToken: vi.fn(async () => undefined),
  };
  const deps: AppDeps = {
    loadConfig: () => ({ token: "nb_secret", url: "https://api.example.com" }),
    saveConfig: vi.fn(),
    clearConfig: vi.fn(),
    createClient: vi.fn(() => client),
    promptSecret: vi.fn(async () => "nb_prompted"),
    readFile: vi.fn(() => Buffer.from("file-bytes")),
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
    expect(names).toEqual(["accounts", "assets", "auth", "workspaces"]);
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
});
