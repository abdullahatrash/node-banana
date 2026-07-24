#!/usr/bin/env -S npx tsx
/**
 * Thin CLI adapter over the production Capability Registry.
 *
 *   pnpm node-banana tools
 *   pnpm node-banana call capabilities.list@1
 *   pnpm node-banana call capabilities.get@1 \
 *     --input '{"name":"capabilities.list","version":1}'
 */
import "./_load-env";
import { parseArgs } from "node:util";
import {
  CAPABILITY_REGISTRY,
  dispatchCliCapability,
  formatCapabilityIdentity,
  isExactCliCapability,
} from "@/lib/agent-tools";

function printTools(): void {
  for (const definition of CAPABILITY_REGISTRY.listDefinitions()) {
    console.log(
      `${formatCapabilityIdentity(definition.identity)}  [${definition.lifecycle.status}, ${definition.idempotency.mode}]`,
    );
    console.log(`    ${definition.summary}`);
    console.log(`    digest: ${definition.contractDigest}`);
    console.log(`    input: ${JSON.stringify(definition.schemas.input)}`);
  }
}

function printHelp(): void {
  console.log(`node-banana — exact-version Application Capability CLI

Usage:
  node-banana tools
  node-banana call <capability@version> [--input '<json>']
  node-banana help

The capability version is mandatory. There is no executable "latest" alias.
Principal and Workspace identity are resolved by authentication outside the
invocation and cannot be supplied as CLI arguments.`);
}

async function main(): Promise<number> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      input: { type: "string" },
      help: { type: "boolean" },
    },
  });

  const command = positionals[0];
  if (!command || command === "help" || values.help) {
    printHelp();
    return command ? 0 : 1;
  }

  if (command === "tools") {
    printTools();
    return 0;
  }

  if (command !== "call") {
    console.error(`Unknown command: ${command}\n`);
    printHelp();
    return 1;
  }

  const exactCapability = positionals[1];
  if (!exactCapability || !isExactCliCapability(exactCapability)) {
    console.error(
      'call requires an exact capability such as "capabilities.list@1".',
    );
    return 1;
  }

  let rawInput: unknown = {};
  if (values.input) {
    try {
      rawInput = JSON.parse(values.input);
    } catch {
      console.error("--input must be valid JSON.");
      return 1;
    }
  }

  const response = await dispatchCliCapability(exactCapability, rawInput);
  console.log(JSON.stringify(response, null, 2));
  return response.type === "capability_error" ? 1 : 0;
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
