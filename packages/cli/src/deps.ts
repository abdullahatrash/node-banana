import { readFileSync } from "node:fs";

import { createApiClient } from "./api/client";
import type { AppDeps } from "./commands/context";
import { clearConfig, loadConfig, saveConfig } from "./config/config";
import { promptSecret } from "./prompt";

/**
 * Wire the real dependencies: filesystem-backed config, a live API client,
 * a TTY secret prompt, and stdout/stderr writers. This is the only place the
 * CLI touches the outside world; commands stay pure and testable behind it.
 */
export function buildDefaultDeps(): AppDeps {
  return {
    loadConfig,
    saveConfig,
    clearConfig,
    createClient: (options) => createApiClient(options),
    promptSecret,
    readFile: (path) => readFileSync(path),
    io: {
      out: (line) => process.stdout.write(`${line}\n`),
      err: (line) => process.stderr.write(`${line}\n`),
    },
  };
}
