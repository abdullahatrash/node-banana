import { z } from "zod";

import { listSocialAccounts, listSocialPosts } from "@/lib/social/repository";

import type { ToolDefinition } from "../types";

const statusSchema = z.enum([
  "draft",
  "queued",
  "publishing",
  "published",
  "failed",
]);

const inputSchema = z.object({
  status: statusSchema.optional(),
  platform: z.string().optional(),
  socialAccountId: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  limit: z.number().int().min(1).max(200).optional(),
});

const postSummarySchema = z.object({
  postId: z.string(),
  socialAccountId: z.string(),
  platform: z.string().nullable(),
  status: z.string(),
  dispatchStatus: z.string().nullable(),
  content: z.string().nullable(),
  scheduledAt: z.string().nullable(),
  publishedAt: z.string().nullable(),
  failureReason: z.string().nullable(),
  releaseUrl: z.string().nullable(),
  createdAt: z.string(),
});

const outputSchema = z.object({
  posts: z.array(postSummarySchema),
});

function toIso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

/**
 * List the workspace's social posts as summaries, filtered by status, platform,
 * account, and date range. Each summary carries the post's place in the
 * dispatch state machine (`status`, `dispatchStatus`) and its `failureReason`,
 * so an agent can survey outcomes without fetching each post individually. The
 * `platform` filter is resolved via the workspace's connected accounts.
 */
export const listSocialPostsTool: ToolDefinition<
  typeof inputSchema,
  typeof outputSchema
> = {
  name: "list_social_posts",
  description:
    "List social posts in this workspace with dispatch status and failure reason. Filter by status, platform, account id, date range (ISO), and limit. Use get_social_post_status for a single post's full state.",
  requiredPermission: "social:view",
  inputSchema,
  outputSchema,
  handler: async (input, ctx) => {
    const workspaceId = ctx.session.workspace.id;

    const accounts = await listSocialAccounts(workspaceId);
    const platformByAccountId = new Map<string, string>(
      accounts.map((account) => [account.id, account.platform]),
    );

    const rows = await listSocialPosts(workspaceId, {
      status: input.status,
      socialAccountId: input.socialAccountId,
      startDate: input.startDate ? new Date(input.startDate) : undefined,
      endDate: input.endDate ? new Date(input.endDate) : undefined,
      limit: input.limit,
    });

    const summaries = rows
      .map((post) => ({
        postId: post.id,
        socialAccountId: post.socialAccountId,
        platform: platformByAccountId.get(post.socialAccountId) ?? null,
        status: post.status,
        dispatchStatus: post.dispatchStatus ?? null,
        content: post.content ?? null,
        scheduledAt: toIso(post.scheduledAt),
        publishedAt: toIso(post.publishedAt),
        failureReason: post.lastDispatchError ?? post.errorMessage ?? null,
        releaseUrl: post.platformPostUrl ?? null,
        createdAt: toIso(post.createdAt) as string,
      }))
      .filter((post) => !input.platform || post.platform === input.platform);

    return { posts: summaries };
  },
};
