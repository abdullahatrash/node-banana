#!/usr/bin/env -S npx tsx
import "./_load-env";
import { pathToFileURL } from "node:url";
import { runCapabilityCli } from "@/lib/agent-tools/cli";
import type { CapabilityCliOptions } from "@/types";

export function runNodeBananaCli(
  argv: string[] = process.argv.slice(2),
  options: CapabilityCliOptions = {},
): Promise<number> {
  return runCapabilityCli(argv, options);
}

function isDirectExecution(): boolean {
  const entry = process.argv[1];
  return Boolean(entry && import.meta.url === pathToFileURL(entry).href);
}

if (isDirectExecution()) {
  runNodeBananaCli()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
