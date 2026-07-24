import { parseArgs } from "node:util";
import {
  discoverCapabilityDefinitions,
  dispatchCliCapability,
  isExactCliCapability,
} from "./adapters";
import {
  CAPABILITY_DISPATCHER,
  formatCapabilityIdentity,
} from "./dispatcher";
import type {
  CapabilityCliIo,
  CapabilityCliOptions,
} from "@/types/capabilities";

const defaultIo: CapabilityCliIo = {
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
};

function helpText(): string {
  return `node-banana — exact-version Application Capability CLI

Usage:
  node-banana tools
  node-banana call <capability@version> [--input '<json>']
  node-banana help

The capability version is mandatory. There is no executable "latest" alias.
Principal and Workspace identity are resolved by authentication outside the
invocation and cannot be supplied as CLI arguments.
`;
}

export async function runCapabilityCli(
  argv: string[],
  options: CapabilityCliOptions = {},
): Promise<number> {
  const dispatcher = options.dispatcher ?? CAPABILITY_DISPATCHER;
  const io = options.io ?? defaultIo;

  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        input: { type: "string" },
        help: { type: "boolean" },
      },
    });
  } catch (error) {
    io.stderr(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }

  const { values, positionals } = parsed;
  const command = positionals[0];
  if (!command || command === "help" || values.help) {
    io.stdout(helpText());
    return command ? 0 : 1;
  }

  if (command === "tools") {
    try {
      const definitions = await discoverCapabilityDefinitions(dispatcher);
      for (const definition of definitions) {
        io.stdout(
          `${formatCapabilityIdentity(definition.identity)}  [${definition.lifecycle.status}, ${definition.idempotency.mode}]\n`,
        );
        io.stdout(`    ${definition.summary}\n`);
        io.stdout(`    digest: ${definition.contractDigest}\n`);
        io.stdout(`    input: ${JSON.stringify(definition.schemas.input)}\n`);
      }
      return 0;
    } catch (error) {
      io.stderr(`${error instanceof Error ? error.message : String(error)}\n`);
      return 1;
    }
  }

  if (command !== "call") {
    io.stderr(`Unknown command: ${command}\n\n`);
    io.stdout(helpText());
    return 1;
  }

  const exactCapability = positionals[1];
  if (!exactCapability || !isExactCliCapability(exactCapability)) {
    io.stderr(
      'call requires an exact capability such as "capabilities.list@1".\n',
    );
    return 1;
  }

  let input: unknown = {};
  if (typeof values.input === "string") {
    try {
      input = JSON.parse(values.input);
    } catch {
      io.stderr("--input must be valid JSON.\n");
      return 1;
    }
  }

  const response = await dispatchCliCapability(
    exactCapability,
    input,
    dispatcher,
  );
  io.stdout(`${JSON.stringify(response, null, 2)}\n`);
  return response.type === "capability_error" ? 1 : 0;
}
