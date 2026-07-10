import { z } from "zod";

import { getWorkspaceById } from "@/lib/studio/repository";

import type { ToolDefinition } from "../types";

const inputSchema = z.object({});

const workspaceSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
});

const outputSchema = z.object({
  workspaces: z.array(workspaceSchema),
});

/**
 * List the workspace(s) the calling token can reach. An API token is scoped to
 * exactly one workspace, so this returns that single workspace (or an empty
 * list if it has since been deleted) — the agent's first call to discover which
 * brand it is acting on.
 */
export const listWorkspacesTool: ToolDefinition<
  typeof inputSchema,
  typeof outputSchema
> = {
  name: "list_workspaces",
  description:
    "List the workspaces (brands) this token can act on. Call this first to confirm which workspace you are scoped to.",
  requiredPermission: "workspaces:read",
  inputSchema,
  outputSchema,
  handler: async (_input, ctx) => {
    const workspace = await getWorkspaceById(ctx.session.workspace.id);
    return { workspaces: workspace ? [workspace] : [] };
  },
};
