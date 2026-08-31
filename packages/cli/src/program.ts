import { Command } from "commander";

import { accountsList } from "./commands/accounts";
import { assetsDownloadUrl, assetsList, assetsUpload } from "./commands/assets";
import { authLogin, authStatus } from "./commands/auth";
import type { AppDeps } from "./commands/context";
import { run, runsStatus } from "./commands/runs";
import { postCreate, postList, postStatus } from "./commands/post";
import { UsageError } from "./errors/errors";
import { workspacesList } from "./commands/workspaces";

/**
 * Read the effective `--json` flag, accepting it either globally (before the
 * subcommand) or on the leaf command (after it). `optsWithGlobals` merges the
 * command chain, so declaring `--json` on both positions makes both work.
 */
function wantsJson(command: Command): boolean {
  let current: Command | null = command;
  while (current) {
    if (current.opts().json) return true;
    current = current.parent;
  }
  return false;
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

  withJson(
    assets
      .command("upload")
      .description("Upload a local file as a workspace asset.")
      .argument("<file>", "path to the local file to upload")
      .option(
        "--type <type>",
        "asset type: image | video | audio | model3d | workflow (inferred from the file extension if omitted)",
      )
      .option("--project-id <id>", "project to attach the asset to")
      .option("--mime-type <mime>", "override the detected content type"),
  ).action(async (file: string, _opts, command: Command) => {
    const options = command.opts<{ type?: string; projectId?: string; mimeType?: string }>();
    await assetsUpload(deps, {
      json: wantsJson(command),
      file,
      ...(options.type !== undefined ? { type: options.type } : {}),
      ...(options.projectId !== undefined ? { projectId: options.projectId } : {}),
      ...(options.mimeType !== undefined ? { mimeType: options.mimeType } : {}),
    });
  });

  withJson(
    assets
      .command("download-url")
      .description("Get a download URL for an asset already in the workspace.")
      .argument("<assetId>", "asset id")
      .option("--expires-in <seconds>", "presigned URL lifetime in seconds"),
  ).action(async (assetId: string, _opts, command: Command) => {
    const options = command.opts<{ expiresIn?: string }>();
    let expiresInSeconds: number | undefined;
    if (options.expiresIn !== undefined) {
      expiresInSeconds = Number(options.expiresIn);
      if (!Number.isInteger(expiresInSeconds) || expiresInSeconds < 1) {
        throw new UsageError("--expires-in must be a positive integer.");
      }
    }
    await assetsDownloadUrl(deps, {
      json: wantsJson(command),
      assetId,
      ...(expiresInSeconds !== undefined ? { expiresInSeconds } : {}),
    });
  });

  withJson(
    program
      .command("run")
      .description("Start a workflow run for a project.")
      .argument("<projectId>", "project id whose workflow to run")
      .option("--wait", "poll until the run reaches a terminal state")
      .option(
        "--key <provider=value...>",
        "BYOK provider key(s), e.g. --key gemini=sk-... (repeatable)",
      ),
  ).action(async (projectId: string, _opts, command: Command) => {
    const options = command.opts<{ wait?: boolean; key?: string[] }>();
    await run(deps, {
      projectId,
      json: wantsJson(command),
      wait: Boolean(options.wait),
      keys: options.key ?? [],
    });
  });

  const runs = program.command("runs").description("Workflow runs.");
  withJson(
    runs
      .command("status")
      .description("Show a run's status, progress, and output asset refs.")
      .argument("<runId>", "run id returned by `nb run`"),
  ).action(async (runId: string, _opts, command: Command) => {
    await runsStatus(deps, { runId, json: wantsJson(command) });
  });

  const post = program
    .command("post")
    .description("Create and track social posts.");

  withJson(
    post
      .command("create")
      .description("Create a social post as a draft, scheduled, or now.")
      .requiredOption("--account <id>", "target social account id")
      .option("--text <text>", "post text/content")
      .option("--media <assetId...>", "workspace asset id(s) to attach")
      .option(
        "--schedule <when>",
        'when to publish: "now", "draft", or an ISO timestamp (default: draft)',
      ),
  ).action(async (_opts, command: Command) => {
    const options = command.opts<{
      account: string;
      text?: string;
      media?: string[];
      schedule?: string;
    }>();
    await postCreate(deps, {
      json: wantsJson(command),
      account: options.account,
      ...(options.text !== undefined ? { text: options.text } : {}),
      ...(options.media !== undefined ? { media: options.media } : {}),
      ...(options.schedule !== undefined ? { schedule: options.schedule } : {}),
    });
  });

  withJson(
    post
      .command("list")
      .description("List social posts with dispatch status.")
      .option(
        "--status <status>",
        "filter by status: draft | queued | publishing | published | failed",
      )
      .option("--platform <platform>", "filter by platform, e.g. x")
      .option("--account <id>", "filter by social account id")
      .option("--limit <n>", "maximum number of posts (1-200)"),
  ).action(async (_opts, command: Command) => {
    const options = command.opts<{
      status?: string;
      platform?: string;
      account?: string;
      limit?: string;
    }>();
    let limit: number | undefined;
    if (options.limit !== undefined) {
      limit = Number(options.limit);
      if (!Number.isInteger(limit) || limit < 1) {
        throw new UsageError("--limit must be a positive integer.");
      }
    }
    await postList(deps, {
      json: wantsJson(command),
      ...(options.status !== undefined ? { status: options.status } : {}),
      ...(options.platform !== undefined ? { platform: options.platform } : {}),
      ...(options.account !== undefined ? { account: options.account } : {}),
      ...(limit !== undefined ? { limit } : {}),
    });
  });

  withJson(
    post
      .command("status")
      .description("Show a single post's full dispatch state.")
      .argument("<postId>", "post id"),
  ).action(async (postId: string, _opts, command: Command) => {
    await postStatus(deps, { json: wantsJson(command), postId });
  });

  return program;
}
