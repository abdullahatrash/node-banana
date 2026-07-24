import type {
  CapabilityDefinition,
  CapabilityResponse,
  JsonSchema,
} from "./contracts";
import {
  CAPABILITY_DISPATCHER,
  type CapabilityDispatcher,
  formatCapabilityIdentity,
  parseCapabilityIdentity,
} from "./dispatcher";

export interface McpCapabilityTool {
  name: string;
  title: string;
  description: string;
  inputSchema: JsonSchema;
  annotations: {
    readOnlyHint: boolean;
    destructiveHint: boolean;
    idempotentHint: boolean;
    openWorldHint: boolean;
  };
}

/** Exact Capability Identity -> MCP-safe, reversible transport spelling. */
export function capabilityIdentityToMcpTool(
  definition: Pick<CapabilityDefinition, "identity">,
): string {
  return `${definition.identity.name}.v${definition.identity.version}`;
}

/** MCP transport spelling -> exact Capability Identity (never an alias). */
export function mcpToolToCapabilityIdentity(toolName: string): string {
  const match = /^(.*)\.v([1-9][0-9]*)$/.exec(toolName);
  return match ? `${match[1]}@${match[2]}` : toolName;
}

export function listMcpCapabilityTools(
  dispatcher: CapabilityDispatcher = CAPABILITY_DISPATCHER,
): McpCapabilityTool[] {
  return dispatcher.registry.listDefinitions().map((definition) => ({
    name: capabilityIdentityToMcpTool(definition),
    title: formatCapabilityIdentity(definition.identity),
    description: `${definition.summary} Exact capability: ${formatCapabilityIdentity(definition.identity)} (${definition.contractDigest}).`,
    inputSchema: definition.schemas.input,
    annotations: {
      readOnlyHint: definition.effect.mutation === "none",
      destructiveHint:
        definition.effect.reversibility === "irreversible" ||
        definition.effect.visibility === "publicly-visible",
      idempotentHint: definition.idempotency.mode !== "key-required",
      openWorldHint: definition.effect.mutation === "external-system",
    },
  }));
}

/**
 * Thin CLI projection. Authentication will be injected out-of-band by its
 * composition root; callers can provide only an exact capability and input.
 */
export function dispatchCliCapability(
  exactCapability: string,
  input: unknown = {},
  dispatcher: CapabilityDispatcher = CAPABILITY_DISPATCHER,
): Promise<CapabilityResponse> {
  return dispatcher.dispatch({ capability: exactCapability, input });
}

/**
 * Thin stdio-MCP projection. It reverses the generated MCP-safe spelling and
 * delegates the canonical invocation unchanged to the shared dispatcher.
 */
export function dispatchMcpCapability(
  mcpToolName: string,
  input: unknown = {},
  dispatcher: CapabilityDispatcher = CAPABILITY_DISPATCHER,
): Promise<CapabilityResponse> {
  return dispatcher.dispatch({
    capability: mcpToolToCapabilityIdentity(mcpToolName),
    input,
  });
}

export function isExactCliCapability(value: string): boolean {
  return parseCapabilityIdentity(value) !== null;
}
