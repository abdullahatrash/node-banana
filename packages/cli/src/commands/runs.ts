import type { RunProviderKeys } from "../api/client";
import type { RunStatus } from "../api/schemas";
import { ApiError, UsageError } from "../errors/errors";
import { formatJson, renderTable } from "../output/output";
import { resolveClient, type AppDeps } from "./context";

const TERMINAL_STATUSES = new Set(["succeeded", "failed", "cancelled"]);
const KNOWN_PROVIDERS = new Set(["gemini", "google", "openai", "anthropic"]);

const DEFAULT_POLL_INTERVAL_MS = 2000;
const DEFAULT_MAX_POLLS = 150; // ~5 min at the default interval.

/** Parse repeatable `--key provider=value` flags into a provider-keys map. */
export function parseProviderKeys(pairs: readonly string[]): RunProviderKeys {
  const keys: RunProviderKeys = {};
  for (const pair of pairs) {
    const eq = pair.indexOf("=");
    if (eq <= 0) {
      throw new UsageError(
        `--key must be provider=value (got '${pair}'). Providers: ${[...KNOWN_PROVIDERS].join(", ")}.`,
      );
    }
    const provider = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    if (!KNOWN_PROVIDERS.has(provider)) {
      throw new UsageError(
        `Unknown provider '${provider}'. Providers: ${[...KNOWN_PROVIDERS].join(", ")}.`,
      );
    }
    if (!value) {
      throw new UsageError(`--key ${provider}= is empty; supply a key value.`);
    }
    keys[provider as keyof RunProviderKeys] = value;
  }
  return keys;
}

function printStatus(deps: AppDeps, status: RunStatus): void {
  deps.io.out(`Run ${status.runId}: ${status.status}`);
  if (status.progress.nodes.length > 0) {
    const rows = status.progress.nodes.map((n) => [
      n.nodeId,
      n.type,
      n.status,
      n.error ?? "-",
    ]);
    deps.io.out(renderTable(["NODE", "TYPE", "STATUS", "ERROR"], rows));
  }
  if (status.outputs.length > 0) {
    const rows = status.outputs.map((o) => [o.nodeId, o.assetId, o.url ?? "-"]);
    deps.io.out(renderTable(["NODE", "ASSET", "URL"], rows));
  }
  if (status.error) {
    deps.io.err(
      `error: ${status.error.code ?? "unknown"} — ${status.error.message ?? ""}`,
    );
  }
}

export interface RunOptions {
  projectId: string;
  json: boolean;
  wait: boolean;
  keys: readonly string[];
  pollIntervalMs?: number;
  maxPolls?: number;
}

/**
 * `nb run <projectId>` — start a workflow run. Without `--wait`, prints the
 * runId and returns immediately. With `--wait`, polls until the run reaches a
 * terminal state, prints the final status/outputs, and exits non-zero (via
 * ApiError) if the run failed so CI can branch on it.
 */
export async function run(deps: AppDeps, opts: RunOptions): Promise<void> {
  const client = resolveClient(deps);
  const providerKeys = parseProviderKeys(opts.keys);

  const started = await client.runWorkflow({
    projectId: opts.projectId,
    ...(Object.keys(providerKeys).length > 0 ? { providerKeys } : {}),
  });

  if (!opts.wait) {
    if (opts.json) {
      deps.io.out(formatJson(started));
      return;
    }
    deps.io.out(`Run started: ${started.runId} (${started.status})`);
    deps.io.out(`Poll with: nb runs status ${started.runId}`);
    return;
  }

  const interval = opts.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const maxPolls = opts.maxPolls ?? DEFAULT_MAX_POLLS;

  let status = await client.getRunStatus(started.runId);
  for (let poll = 0; poll < maxPolls && !TERMINAL_STATUSES.has(status.status); poll++) {
    await deps.sleep(interval);
    status = await client.getRunStatus(started.runId);
  }

  if (opts.json) {
    deps.io.out(formatJson(status));
  } else {
    printStatus(deps, status);
  }

  if (status.status === "failed") {
    throw new ApiError({
      code: status.error?.code ?? undefined,
      message: status.error?.message ?? "Workflow run failed.",
      fix: "Inspect per-node errors with `nb runs status <runId>` and fix the failing node.",
    });
  }
}

export interface RunsStatusOptions {
  runId: string;
  json: boolean;
}

/** `nb runs status <runId>` — one-shot read of a run's status. */
export async function runsStatus(
  deps: AppDeps,
  opts: RunsStatusOptions,
): Promise<void> {
  const client = resolveClient(deps);
  const status = await client.getRunStatus(opts.runId);

  if (opts.json) {
    deps.io.out(formatJson(status));
    return;
  }
  printStatus(deps, status);
}
