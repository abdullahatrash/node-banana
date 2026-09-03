import {
  createSocialPost,
  deleteSocialPost,
  getSocialPost,
  listSocialAccounts,
  listSocialPosts,
  updateSocialPost,
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

/** A committed (non-draft) post on the workspace calendar. */
export interface CopilotCalendarEntry {
  postId: string;
  channelId: string;
  status: string;
  scheduledAt: string | null;
  content: string | null;
}

function toIso(value: Date | string | null): string | null {
  return value instanceof Date ? value.toISOString() : (value ?? null);
}

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

/**
 * Update a draft's content, per-channel Publishing Settings, and/or schedule.
 * Workspace-scoped (the repo verifies ownership). Backs the `updateDraft` tool.
 */
export async function updateDraftForWorkspace(
  ctx: CopilotContext,
  postId: string,
  input: {
    content?: string;
    platformSettings?: Record<string, unknown>;
    scheduledAt?: string | null;
  },
): Promise<CopilotDraft> {
  const data: {
    content?: string;
    platformSettings?: Record<string, unknown>;
    scheduledAt?: Date | null;
  } = {};
  if (input.content !== undefined) data.content = input.content;
  if (input.platformSettings !== undefined) data.platformSettings = input.platformSettings;
  if (input.scheduledAt !== undefined) {
    data.scheduledAt = input.scheduledAt === null ? null : new Date(input.scheduledAt);
  }

  const row = await updateSocialPost(ctx.workspaceId, postId, data);
  return toCopilotDraft(row as SocialPostRow);
}

/** Delete a draft, scoped to the workspace. Backs the `deleteDraft` tool. */
export async function deleteDraftForWorkspace(
  ctx: CopilotContext,
  postId: string,
): Promise<{ postId: string; deleted: true }> {
  await deleteSocialPost(ctx.workspaceId, postId);
  return { postId, deleted: true };
}

/**
 * Duplicate a draft into a new draft, optionally retargeting a different
 * Channel (enables Reddit one-subreddit-per-post fanout and retargeting, ADR
 * 0004). Backs the `duplicateDraft` tool.
 */
export async function duplicateDraftForWorkspace(
  ctx: CopilotContext,
  postId: string,
  opts?: { channelId?: string },
): Promise<CopilotDraft> {
  const source = (await getSocialPost(ctx.workspaceId, postId)) as SocialPostRow & {
    mediaUrls: Array<{ type: string; url: string; alt?: string }> | null;
    stableMediaRefs: Array<{ resourceKind?: "studio_asset" | "artifact"; assetId: string; assetDigest: string; order: number }>;
    platformSettings: Record<string, unknown> | null;
  };

  const row = await createSocialPost({
    workspaceId: ctx.workspaceId,
    socialAccountId: opts?.channelId ?? source.socialAccountId,
    content: source.content ?? undefined,
    mediaUrls: source.mediaUrls ?? undefined,
    mediaReferences: source.stableMediaRefs.sort((left, right) => left.order - right.order).map((reference) => ({ resourceKind: reference.resourceKind ?? "studio_asset" as const, id: reference.assetId, digest: reference.assetDigest })),
    platformSettings: source.platformSettings ?? undefined,
    createdByUserId: ctx.userId,
  });
  return toCopilotDraft(row as SocialPostRow);
}

/**
 * List committed (non-draft) posts whose calendar date falls in the range, so
 * the copilot can reason about cadence and avoid collisions. Backs the
 * `listScheduledPosts` tool.
 */
export async function listScheduledPostsForWorkspace(
  ctx: CopilotContext,
  range: { start: string; end: string },
): Promise<CopilotCalendarEntry[]> {
  const rows = (await listSocialPosts(ctx.workspaceId, {
    startDate: new Date(range.start),
    endDate: new Date(range.end),
  })) as SocialPostRow[];

  return rows
    .filter((row) => row.status !== "draft")
    .map((row) => ({
      postId: row.id,
      channelId: row.socialAccountId,
      status: row.status,
      scheduledAt: toIso(row.scheduledAt),
      content: row.content,
    }));
}
