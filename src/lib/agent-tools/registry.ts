import { createSocialPostTool } from "./tools/create-social-post";
import { getAssetDownloadUrlTool } from "./tools/get-asset-download-url";
import { getRunStatusTool } from "./tools/get-run-status";
import { getSocialPostStatusTool } from "./tools/get-social-post-status";
import { listAssetsTool } from "./tools/list-assets";
import { listSocialAccountsTool } from "./tools/list-social-accounts";
import { listSocialPostsTool } from "./tools/list-social-posts";
import { listWorkspacesTool } from "./tools/list-workspaces";
import { runWorkflowTool } from "./tools/run-workflow";
import { uploadAssetTool } from "./tools/upload-asset";
import type { AnyToolDefinition } from "./types";

/**
 * The tool registry — the single source of truth for the agent surface.
 *
 * Every adapter (MCP server, CLI, public API v1) derives its behaviour from
 * this array; none re-declares a tool. Adding a tool here makes it available on
 * all surfaces at once. Keep it ordered by the sequence an agent typically
 * follows: discover workspace → discover accounts → discover assets → post.
 */
export const toolRegistry: readonly AnyToolDefinition[] = [
  listWorkspacesTool,
  listSocialAccountsTool,
  listAssetsTool,
  uploadAssetTool,
  getAssetDownloadUrlTool,
  runWorkflowTool,
  getRunStatusTool,
  createSocialPostTool,
  listSocialPostsTool,
  getSocialPostStatusTool,
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
