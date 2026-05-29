import { tool } from "ai";
import { z } from "zod";
import type { CopilotContext } from "../context";
import { listChannelsForWorkspace } from "../channels";
import {
  createDrafts,
  listDraftsForWorkspace,
  getDraftForWorkspace,
  updateDraftForWorkspace,
} from "../drafts";
import { getPublishingSettingsSchema } from "../settings";
import { listMediaPoolAssets, attachMedia } from "../media";
import { validatePublishForDraft } from "../validate";
import { scheduleDraftForWorkspace, publishNowForWorkspace } from "../commit";

/** Tools whose use signals the agent is working with a concrete draft. */
export const DRAFT_CONTEXT_TOOL_NAMES = [
  "createDraft",
  "getDraft",
  "listDrafts",
  "updateDraft",
];

/** Irreversible commit tools, gated behind needsApproval + staged until a draft exists. */
export const COMMIT_TOOL_NAMES = ["scheduleDraft", "publishNow"];
import type { SocialPlatform } from "@/lib/db/schema";

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

    updateDraft: tool({
      description:
        "Update an existing draft: change its text, set per-platform Publishing Settings, and/or set a scheduled time (ISO 8601). Only provide the fields you want to change.",
      inputSchema: z.object({
        postId: z.string().describe("The draft post id"),
        content: z.string().optional().describe("New post text"),
        platformSettings: z
          .record(z.string(), z.unknown())
          .optional()
          .describe("Per-platform Publishing Settings (see getPublishingSettingsSchema)"),
        scheduledAt: z
          .string()
          .nullable()
          .optional()
          .describe("ISO 8601 time to schedule, or null to clear"),
      }),
      execute: async ({ postId, content, platformSettings, scheduledAt }) => ({
        draft: await updateDraftForWorkspace(ctx, postId, {
          content,
          platformSettings,
          scheduledAt,
        }),
      }),
    }),

    getPublishingSettingsSchema: tool({
      description:
        "Get the per-platform Publishing Settings fields and safe defaults for a platform (e.g. Reddit subreddit, Mastodon visibility). Returns null if the platform has no extra settings.",
      inputSchema: z.object({
        platform: z.string().describe("Platform identifier, e.g. youtube, mastodon, reddit"),
      }),
      execute: async ({ platform }) => ({
        schema: getPublishingSettingsSchema(platform as SocialPlatform),
      }),
    }),

    listMediaPoolAssets: tool({
      description:
        "List the workspace's media-pool assets (generated/uploaded images and videos) so they can be attached to a draft.",
      inputSchema: z.object({
        type: z.enum(["image", "video"]).optional().describe("Filter by media type"),
        limit: z.number().int().positive().max(50).optional(),
      }),
      execute: async ({ type, limit }) => ({
        assets: await listMediaPoolAssets(ctx, { type, limit }),
      }),
    }),

    attachMedia: tool({
      description:
        "Attach one or more media-pool assets (by asset id from listMediaPoolAssets) to a draft.",
      inputSchema: z.object({
        postId: z.string().describe("The draft post id"),
        assetIds: z.array(z.string()).min(1).describe("Asset ids to attach"),
      }),
      execute: async ({ postId, assetIds }) => attachMedia(ctx, postId, assetIds),
    }),

    validatePublish: tool({
      description:
        "Check whether a draft is ready to publish. Returns per-channel readiness with reasons for anything blocking (content length, missing required Publishing Settings, empty post). Always run this before suggesting the user schedule or publish.",
      inputSchema: z.object({
        postId: z.string().describe("The draft post id"),
      }),
      execute: async ({ postId }) => ({
        readiness: await validatePublishForDraft(ctx, postId),
      }),
    }),

    scheduleDraft: tool({
      description:
        "Schedule a draft to publish at a specific time (ISO 8601). Requires the user's explicit approval. Re-validates the draft server-side and refuses if it isn't ready.",
      inputSchema: z.object({
        postId: z.string().describe("The draft post id"),
        scheduledAt: z.string().describe("ISO 8601 time to publish"),
      }),
      needsApproval: true,
      execute: async ({ postId, scheduledAt }) =>
        scheduleDraftForWorkspace(ctx, postId, scheduledAt),
    }),

    publishNow: tool({
      description:
        "Publish a draft immediately. Requires the user's explicit approval. Re-validates the draft server-side and refuses if it isn't ready.",
      inputSchema: z.object({
        postId: z.string().describe("The draft post id"),
      }),
      needsApproval: true,
      execute: async ({ postId }) => publishNowForWorkspace(ctx, postId),
    }),
  };
}

export type CopilotTools = ReturnType<typeof createCopilotTools>;
