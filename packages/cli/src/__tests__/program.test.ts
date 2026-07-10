import { describe, expect, it, vi } from "vitest";

import type { ApiClient } from "../api/client";
import type { AppDeps } from "../commands/context";
import { buildProgram } from "../program";

function makeDeps(): { deps: AppDeps; out: string[] } {
  const out: string[] = [];
  const client: ApiClient = {
    listWorkspaces: vi.fn(async () => [{ id: "ws_1", name: "Acme", slug: "acme" }]),
    listSocialAccounts: vi.fn(async () => []),
    listAssets: vi.fn(async () => []),
    verifyToken: vi.fn(async () => undefined),
  };
  const deps: AppDeps = {
    loadConfig: () => ({ token: "nb_secret", url: "https://api.example.com" }),
    saveConfig: vi.fn(),
    clearConfig: vi.fn(),
    createClient: vi.fn(() => client),
    promptSecret: vi.fn(async () => "nb_prompted"),
    io: { out: (line) => out.push(line), err: () => {} },
  };
  return { deps, out };
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
});
