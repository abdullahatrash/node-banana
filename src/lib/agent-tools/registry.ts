import { listAssetsTool } from "./tools/list-assets";
import { listSocialAccountsTool } from "./tools/list-social-accounts";
import { listWorkspacesTool } from "./tools/list-workspaces";
import type { AnyToolDefinition } from "./types";

/**
 * The tool registry — the single source of truth for the agent surface.
 *
 * Every adapter (MCP server, CLI, public API v1) derives its behaviour from
 * this array; none re-declares a tool. Adding a tool here makes it available on
 * all surfaces at once. Keep it ordered by the sequence an agent typically
 * follows: discover workspace → discover accounts → discover assets.
 */
export const toolRegistry: readonly AnyToolDefinition[] = [
  listWorkspacesTool,
  listSocialAccountsTool,
  listAssetsTool,
] as const;

const toolsByName = new Map<string, AnyToolDefinition>(
  toolRegistry.map((tool) => [tool.name, tool]),
);

export function getTool(name: string): AnyToolDefinition | undefined {
  return toolsByName.get(name);
}

export function listToolNames(): string[] {
  return toolRegistry.map((tool) => tool.name);
}
