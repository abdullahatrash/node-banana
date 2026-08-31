import type { CreatePostInput, ListPostsOptions } from "../api/client";
import { UsageError } from "../errors/errors";
import { formatJson, renderTable } from "../output/output";
import { resolveClient, type AppDeps } from "./context";

/**
 * Translate the `--schedule` value into the API's create-post fields.
 *
 * - `draft` (the default when omitted): create an unqueued draft.
 * - `now`: publish immediately.
 * - an ISO timestamp: schedule for that time.
 *
 * Defaulting to `draft` keeps a bare `nb post create` from publishing by
 * accident; `--schedule now` is the explicit opt-in to go live.
 */
function scheduleFields(schedule: string | undefined): {
  draft?: boolean;
  scheduledAt?: string;
} {
  const value = schedule ?? "draft";
  if (value === "draft") return { draft: true };
  if (value === "now") return {};

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new UsageError(
      `--schedule must be "now", "draft", or an ISO timestamp; got "${value}".`,
    );
  }
  return { scheduledAt: value };
}

/**
 * `nb post create --account <id> --text "..." [--media assetId ...]
 * [--schedule ISO|now|draft]` — create a social post through the same pipeline
 * the app composer uses. Media are workspace asset ids resolved to URLs
 * server-side.
 */
export async function postCreate(
  deps: AppDeps,
  opts: {
    json: boolean;
    account: string;
    text?: string;
    media?: string[];
    schedule?: string;
  },
): Promise<void> {
  const client = resolveClient(deps);

  if (!opts.text && (!opts.media || opts.media.length === 0)) {
    throw new UsageError(
      "A post needs --text, at least one --media asset id, or both.",
    );
  }

  const input: CreatePostInput = {
    socialAccountId: opts.account,
    ...(opts.text !== undefined ? { content: opts.text } : {}),
    ...(opts.media && opts.media.length > 0 ? { mediaAssetIds: opts.media } : {}),
    ...scheduleFields(opts.schedule),
  };

  const result = await client.createPost(input);

  if (opts.json) {
    deps.io.out(formatJson(result));
    return;
  }

  deps.io.out(`Created post ${result.postId} (${result.status})`);
  if (result.scheduledAt) {
    deps.io.out(`Scheduled for ${result.scheduledAt}`);
  }
}

/**
 * `nb post list [--status ...] [--platform ...] [--account ...] [--limit ...]`
 * — the workspace's posts as summaries, each showing its place in the dispatch
 * state machine and any failure reason.
 */
export async function postList(
  deps: AppDeps,
  opts: {
    json: boolean;
    status?: string;
    platform?: string;
    account?: string;
    limit?: number;
  },
): Promise<void> {
  const client = resolveClient(deps);

  const listOptions: ListPostsOptions = {};
  if (opts.status !== undefined) listOptions.status = opts.status;
  if (opts.platform !== undefined) listOptions.platform = opts.platform;
  if (opts.account !== undefined) listOptions.socialAccountId = opts.account;
  if (opts.limit !== undefined) listOptions.limit = opts.limit;

  const posts = await client.listPosts(listOptions);

  if (opts.json) {
    deps.io.out(formatJson(posts));
    return;
  }

  if (posts.length === 0) {
    deps.io.out("No posts found for this workspace.");
    return;
  }

  const rows = posts.map((p) => [
    p.postId,
    p.platform ?? "-",
    p.status,
    p.dispatchStatus ?? "-",
    p.scheduledAt ?? "-",
    p.failureReason ?? "-",
  ]);
  deps.io.out(
    renderTable(
      ["POST ID", "PLATFORM", "STATUS", "DISPATCH", "SCHEDULED", "FAILURE"],
      rows,
    ),
  );
}

/**
 * `nb post status <postId>` — the full dispatch state of a single post,
 * including attempts, the last error, and the published release URL.
 */
export async function postStatus(
  deps: AppDeps,
  opts: { json: boolean; postId: string },
): Promise<void> {
  const client = resolveClient(deps);
  const status = await client.getPostStatus(opts.postId);

  if (opts.json) {
    deps.io.out(formatJson(status));
    return;
  }

  deps.io.out(`Post:        ${status.postId}`);
  deps.io.out(`Status:      ${status.status}`);
  deps.io.out(`Dispatch:    ${status.dispatchStatus ?? "-"}`);
  deps.io.out(`Attempts:    ${status.dispatchAttempts}`);
  if (status.scheduledAt) deps.io.out(`Scheduled:   ${status.scheduledAt}`);
  if (status.publishedAt) deps.io.out(`Published:   ${status.publishedAt}`);
  if (status.releaseUrl) deps.io.out(`Release URL: ${status.releaseUrl}`);
  if (status.lastError) deps.io.out(`Last error:  ${status.lastError}`);
}
