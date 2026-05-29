import {
  createSocialPost,
  getSocialPost,
  listSocialAccounts,
  listSocialPosts,
} from "@/lib/social/repository";
import type { CopilotContext } from "./context";

/** A draft post as the copilot surfaces it. Never carries internal columns. */
export interface CopilotDraft {
  id: string;
  socialAccountId: string;
  status: string;
  content: string | null;
  scheduledAt: string | null;
}

type SocialPostRow = {
  id: string;
  socialAccountId: string;
  status: string;
  content: string | null;
  scheduledAt: Date | string | null;
};

function toCopilotDraft(row: SocialPostRow): CopilotDraft {
  return {
    id: row.id,
    socialAccountId: row.socialAccountId,
    status: row.status,
    content: row.content,
    scheduledAt:
      row.scheduledAt instanceof Date
        ? row.scheduledAt.toISOString()
        : (row.scheduledAt ?? null),
  };
}

/**
 * Create one draft post per selected Channel (a post row maps to one Channel).
 * Backs the `createDraft` copilot tool.
 */
export async function createDrafts(
  ctx: CopilotContext,
  input: { content: string; channelIds: string[] },
): Promise<CopilotDraft[]> {
  const accounts = await listSocialAccounts(ctx.workspaceId);
  const validIds = new Set(accounts.map((a) => a.id));
  const unknown = input.channelIds.filter((id) => !validIds.has(id));
  if (unknown.length > 0) {
    throw new Error(`Unknown channel(s) for this workspace: ${unknown.join(", ")}`);
  }

  const drafts: CopilotDraft[] = [];
  for (const channelId of input.channelIds) {
    const row = await createSocialPost({
      workspaceId: ctx.workspaceId,
      socialAccountId: channelId,
      content: input.content,
      createdByUserId: ctx.userId,
    });
    drafts.push(toCopilotDraft(row as SocialPostRow));
  }
  return drafts;
}

/** List the workspace's draft posts. Backs the `listDrafts` copilot tool. */
export async function listDraftsForWorkspace(
  ctx: CopilotContext,
): Promise<CopilotDraft[]> {
  const rows = await listSocialPosts(ctx.workspaceId, { status: "draft" });
  return (rows as SocialPostRow[]).map(toCopilotDraft);
}

/** Fetch a single draft, scoped to the workspace. Backs the `getDraft` tool. */
export async function getDraftForWorkspace(
  ctx: CopilotContext,
  postId: string,
): Promise<CopilotDraft> {
  const row = await getSocialPost(ctx.workspaceId, postId);
  return toCopilotDraft(row as SocialPostRow);
}
