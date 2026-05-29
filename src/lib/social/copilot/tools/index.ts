import { tool } from "ai";
import { z } from "zod";
import type { CopilotContext } from "../context";
import { listChannelsForWorkspace } from "../channels";
import {
  createDrafts,
  listDraftsForWorkspace,
  getDraftForWorkspace,
} from "../drafts";

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

    createDraft: tool({
      description:
        "Create a draft post. Provide the content and the channel id(s) to target (one draft row is created per channel). Call listChannels first to get valid channel ids. Drafts are not published — the user reviews and schedules them separately.",
      inputSchema: z.object({
        content: z.string().describe("The post text"),
        channelIds: z
          .array(z.string())
          .min(1)
          .describe("Channel ids to draft for (from listChannels)"),
      }),
      execute: async ({ content, channelIds }) => ({
        drafts: await createDrafts(ctx, { content, channelIds }),
      }),
    }),

    listDrafts: tool({
      description: "List the workspace's existing draft posts.",
      inputSchema: z.object({}),
      execute: async () => ({ drafts: await listDraftsForWorkspace(ctx) }),
    }),

    getDraft: tool({
      description: "Fetch a single draft post by its id.",
      inputSchema: z.object({
        postId: z.string().describe("The draft post id"),
      }),
      execute: async ({ postId }) => ({ draft: await getDraftForWorkspace(ctx, postId) }),
    }),
  };
}

export type CopilotTools = ReturnType<typeof createCopilotTools>;
