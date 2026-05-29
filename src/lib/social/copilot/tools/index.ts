import { tool } from "ai";
import { z } from "zod";
import type { CopilotContext } from "../context";
import { listChannelsForWorkspace } from "../channels";

/**
 * Build the Social Copilot tool set bound to a request context.
 *
 * Every tool's `execute` closes over the injected `ctx` — no tool reads the
 * HTTP session directly — so this exact set can be reused by a future MCP
 * server with a context derived from an API key instead. See ADR 0008.
 */
export function createCopilotTools(ctx: CopilotContext) {
  return {
    listChannels: tool({
      description:
        "List the workspace's connected social Channels with their platform capabilities (max content length, image/video/carousel support, max images) and health (disabled, needs re-auth). Call this before drafting so content fits each Channel.",
      inputSchema: z.object({}),
      execute: async () => ({ channels: await listChannelsForWorkspace(ctx) }),
    }),
  };
}

export type CopilotTools = ReturnType<typeof createCopilotTools>;
