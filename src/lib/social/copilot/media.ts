import { getAsset, listWorkspaceAssets } from "@/lib/studio/repository";
import { getSocialPost, updateSocialPost } from "@/lib/social/repository";
import type { CopilotContext } from "./context";

export interface CopilotMediaItem {
  type: string;
  url: string;
  alt?: string;
}

export interface CopilotMediaAsset {
  id: string;
  type: string;
  mimeType: string | null;
  storageKey: string;
  width: number | null;
  height: number | null;
}

type AssetRow = {
  id: string;
  type: string;
  mimeType: string | null;
  storageKey: string;
  width: number | null;
  height: number | null;
};

function toCopilotMediaAsset(row: AssetRow): CopilotMediaAsset {
  return {
    id: row.id,
    type: row.type,
    mimeType: row.mimeType,
    storageKey: row.storageKey,
    width: row.width,
    height: row.height,
  };
}

/**
 * List the workspace's media-pool assets for the copilot to attach. Backs the
 * `listMediaPoolAssets` tool. Workspace-wide because the copilot has no project
 * context.
 */
export async function listMediaPoolAssets(
  ctx: CopilotContext,
  opts?: { type?: "image" | "video"; limit?: number },
): Promise<CopilotMediaAsset[]> {
  const rows = await listWorkspaceAssets(ctx.workspaceId, opts);
  return (rows as AssetRow[]).map(toCopilotMediaAsset);
}

/**
 * Attach media-pool asset(s) to a draft by id. Resolves each asset within the
 * workspace (rejecting unknown ids), then appends them to the draft's existing
 * media as `{ type, url: storageKey }` references. Backs the `attachMedia` tool.
 */
export async function attachMedia(
  ctx: CopilotContext,
  postId: string,
  assetIds: string[],
): Promise<{ postId: string; media: CopilotMediaItem[] }> {
  const post = (await getSocialPost(ctx.workspaceId, postId)) as {
    mediaUrls: CopilotMediaItem[] | null;
    stableMediaRefs: Array<{ resourceKind?: "studio_asset" | "artifact"; assetId: string; assetDigest: string; order: number }>;
  };

  const newItems: CopilotMediaItem[] = [];
  for (const assetId of assetIds) {
    const asset = (await getAsset(ctx.workspaceId, assetId)) as {
      type: string;
      storageKey: string;
    } | null;
    if (!asset) {
      throw new Error(`Unknown asset for this workspace: ${assetId}`);
    }
    newItems.push({ type: asset.type, url: asset.storageKey });
  }

  const media = [...(post.mediaUrls ?? []), ...newItems];
  await updateSocialPost(ctx.workspaceId, postId, {
    mediaUrls: media,
    mediaReferences: [
      ...post.stableMediaRefs.sort((left, right) => left.order - right.order).map((reference) => ({ resourceKind: reference.resourceKind ?? "studio_asset" as const, id: reference.assetId, digest: reference.assetDigest })),
      ...assetIds.map((id) => ({ resourceKind: "studio_asset" as const, id })),
    ],
  });
  return { postId, media };
}
