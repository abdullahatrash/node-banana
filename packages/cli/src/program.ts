import { Command } from "commander";

import { accountsList } from "./commands/accounts";
import { assetsList } from "./commands/assets";
import { authLogin, authStatus } from "./commands/auth";
import type { AppDeps } from "./commands/context";
import { UsageError } from "./errors/errors";
import { workspacesList } from "./commands/workspaces";

/**
 * Read the effective `--json` flag, accepting it either globally (before the
 * subcommand) or on the leaf command (after it). `optsWithGlobals` merges the
 * command chain, so declaring `--json` on both positions makes both work.
 */
function wantsJson(command: Command): boolean {
  return Boolean(command.optsWithGlobals().json);
}

function withJson(command: Command): Command {
  return command.option("--json", "output machine-readable JSON");
}

/**
 * Build the `nb` command tree from injected dependencies. Every action is a
 * thin call into a command function; no business logic lives here. Errors
 * thrown by command functions propagate to the caller (index.ts), which maps
 * them to exit codes.
 */
export function buildProgram(deps: AppDeps): Command {
  const program = new Command();
  program
    .name("nb")
    .description("Node Banana CLI — drive the public API from a terminal or CI.")
    .option("--json", "output machine-readable JSON")
    .enablePositionalOptions();

  const auth = program.command("auth").description("Authenticate the CLI.");

  withJson(
    auth
      .command("login")
      .description("Store and verify an API token.")
      .option("--token <token>", "workspace-scoped API token (nb_...)")
      .option("--url <url>", "API base URL, e.g. https://app.example.com"),
  ).action(async (_opts, command: Command) => {
    const options = command.opts<{ token?: string; url?: string }>();
    await authLogin(deps, {
      json: wantsJson(command),
      ...(options.token !== undefined ? { token: options.token } : {}),
      ...(options.url !== undefined ? { url: options.url } : {}),
    });
  });

  withJson(auth.command("status").description("Show the stored login state.")).action(
    async (_opts, command: Command) => {
      await authStatus(deps, { json: wantsJson(command) });
    },
  );

  const workspaces = program
    .command("workspaces")
    .description("Workspaces (brands) this token can reach.");
  withJson(workspaces.command("list").description("List workspaces.")).action(
    async (_opts, command: Command) => {
      await workspacesList(deps, { json: wantsJson(command) });
    },
  );

  const accounts = program
    .command("accounts")
    .description("Connected social accounts (channels).");
  withJson(accounts.command("list").description("List social accounts.")).action(
    async (_opts, command: Command) => {
      await accountsList(deps, { json: wantsJson(command) });
    },
  );

  const assets = program.command("assets").description("Workspace media assets.");
  withJson(
    assets
      .command("list")
      .description("List media assets.")
      .option(
        "--type <type>",
        "filter by type: image | video | audio | model3d | workflow",
      )
      .option("--limit <n>", "maximum number of assets (1-200)"),
  ).action(async (_opts, command: Command) => {
    const options = command.opts<{ type?: string; limit?: string }>();
    let limit: number | undefined;
    if (options.limit !== undefined) {
      limit = Number(options.limit);
      if (!Number.isInteger(limit) || limit < 1) {
        throw new UsageError("--limit must be a positive integer.");
      }
    }
    await assetsList(deps, {
      json: wantsJson(command),
      ...(options.type !== undefined ? { type: options.type } : {}),
      ...(limit !== undefined ? { limit } : {}),
    });
  });

  return program;
}
