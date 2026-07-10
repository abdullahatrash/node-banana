#!/usr/bin/env node
import { CommanderError } from "commander";

import { buildDefaultDeps } from "./deps";
import { CliError, EXIT_OK, EXIT_USAGE, renderError } from "./errors/errors";
import { buildProgram } from "./program";

/**
 * CLI entry point. Runs the command tree and maps any failure to an exit code:
 *  - commander help/version   → 0
 *  - commander usage errors   → 2 (message already printed by commander)
 *  - CliError (usage/API)     → its own exit code, with a rendered message
 *  - anything else            → 1
 */
async function main(): Promise<number> {
  const deps = buildDefaultDeps();
  const program = buildProgram(deps);
  program.exitOverride();

  try {
    await program.parseAsync(process.argv);
    return EXIT_OK;
  } catch (error) {
    if (error instanceof CommanderError) {
      if (
        error.code === "commander.helpDisplayed" ||
        error.code === "commander.help" ||
        error.code === "commander.version"
      ) {
        return EXIT_OK;
      }
      // Usage errors: commander has already written its own message to stderr.
      return EXIT_USAGE;
    }

    if (error instanceof CliError) {
      deps.io.err(renderError(error));
      return error.exitCode;
    }

    deps.io.err(renderError(error));
    return 1;
  }
}

void main().then((code) => {
  process.exitCode = code;
});
