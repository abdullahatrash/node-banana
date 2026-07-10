import { z } from "zod";

import {
  getSocialPost,
  SocialPostNotFoundError,
} from "@/lib/social/repository";

import { ToolError } from "../errors";
import type { ToolDefinition } from "../types";

const inputSchema = z.object({
  postId: z.string(),
});

const outputSchema = z.object({
  postId: z.string(),
  socialAccountId: z.string(),
  status: z.string(),
  dispatchStatus: z.string().nullable(),
  dispatchAttempts: z.number(),
  retryCount: z.number(),
  scheduledAt: z.string().nullable(),
  publishedAt: z.string().nullable(),
  nextDispatchAt: z.string().nullable(),
  lastError: z.string().nullable(),
  platformPostId: z.string().nullable(),
  releaseUrl: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

function toIso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

/**
 * Read the full dispatch state of a single social post — the same row the app's
 * composer/calendar shows. Surfaces the post's place in the dispatch state
 * machine (`status`, `dispatchStatus`, `dispatchAttempts`), the failure reason
 * when it stalled or failed (`lastError`), and the public `releaseUrl` once it
 * published, so an agent can report outcomes and retry intelligently.
 */
export const getSocialPostStatusTool: ToolDefinition<
  typeof inputSchema,
  typeof outputSchema
> = {
  name: "get_social_post_status",
  description:
    "Get the full dispatch state of a social post by id: status, dispatch status, attempts, failure reason, and the published release URL. Use it to poll a scheduled or publishing post.",
  requiredPermission: "social:view",
  inputSchema,
  outputSchema,
  handler: async (input, ctx) => {
    let post;
    try {
      post = await getSocialPost(ctx.session.workspace.id, input.postId);
    } catch (error) {
      if (error instanceof SocialPostNotFoundError) {
        throw new ToolError({
          code: "not_found",
          message: "Social post not found.",
          fix: "Check the post id, or call list_social_posts to find a valid one.",
        });
      }
      throw error;
    }

    return {
      postId: post.id,
      socialAccountId: post.socialAccountId,
      status: post.status,
      dispatchStatus: post.dispatchStatus ?? null,
      dispatchAttempts: post.dispatchAttempts ?? 0,
      retryCount: post.retryCount ?? 0,
      scheduledAt: toIso(post.scheduledAt),
      publishedAt: toIso(post.publishedAt),
      nextDispatchAt: toIso(post.nextDispatchAt),
      lastError: post.lastDispatchError ?? post.errorMessage ?? null,
      platformPostId: post.platformPostId ?? null,
      releaseUrl: post.platformPostUrl ?? null,
      createdAt: toIso(post.createdAt) as string,
      updatedAt: toIso(post.updatedAt) as string,
    };
  },
};
