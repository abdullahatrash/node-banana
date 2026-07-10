import type { z } from "zod";

import type { ContentOSPermission, ContentOSSession } from "@/lib/studio/authz";

/**
 * Everything a tool handler is allowed to know about the caller. The session is
 * already resolved and workspace-scoped by the calling adapter (MCP route, v1
 * route, CLI) via `authorizePublicApiRequest`, so handlers never touch raw
 * tokens or headers — tenant isolation is guaranteed before the handler runs.
 */
export interface ToolContext {
  session: ContentOSSession;
}

/**
 * A single tool definition — the one source of truth. The MCP server, the CLI,
 * and the public API v1 routes all derive their behaviour from this shape; none
 * of them re-declares a tool. Each surface is a thin adapter over the registry.
 */
export interface ToolDefinition<
  InputSchema extends z.ZodTypeAny = z.ZodTypeAny,
  OutputSchema extends z.ZodTypeAny = z.ZodTypeAny,
> {
  /** Stable machine name (snake_case), e.g. `list_social_accounts`. */
  name: string;
  /** Human/agent-facing description surfaced in MCP tool discovery. */
  description: string;
  /** Permission the caller's workspace role must hold to run this tool. */
  requiredPermission: ContentOSPermission;
  inputSchema: InputSchema;
  outputSchema: OutputSchema;
  handler: (
    input: z.infer<InputSchema>,
    ctx: ToolContext,
  ) => Promise<z.infer<OutputSchema>>;
}

/** A tool definition with its schemas erased, for storing heterogeneously. */
export type AnyToolDefinition = ToolDefinition<z.ZodTypeAny, z.ZodTypeAny>;
