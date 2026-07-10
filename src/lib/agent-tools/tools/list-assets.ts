import { z } from "zod";

import { listWorkspaceAssets } from "@/lib/studio/repository";

import type { ToolDefinition } from "../types";

const assetTypeSchema = z.enum([
  "image",
  "video",
  "audio",
  "model3d",
  "workflow",
]);

const inputSchema = z.object({
  type: assetTypeSchema.optional(),
  limit: z.number().int().min(1).max(200).optional(),
});

const assetSchema = z.object({
  id: z.string(),
  projectId: z.string().nullable(),
  type: assetTypeSchema,
  mimeType: z.string().nullable(),
  sizeBytes: z.number().nullable(),
  width: z.number().nullable(),
  height: z.number().nullable(),
  durationSeconds: z.number().nullable(),
  createdAt: z.string(),
});

const outputSchema = z.object({
  assets: z.array(assetSchema),
});

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

/**
 * List the media assets in the token's workspace, optionally filtered by type
 * and capped by limit. Assets are referenced by id when composing posts, so an
 * agent can reuse generated media without re-uploading.
 */
export const listAssetsTool: ToolDefinition<
  typeof inputSchema,
  typeof outputSchema
> = {
  name: "list_assets",
  description:
    "List media assets (image, video, audio, model3d, workflow) in this workspace. Filter by `type` and cap with `limit`. Reference returned ids when composing posts.",
  requiredPermission: "assets:read",
  inputSchema,
  outputSchema,
  handler: async (input, ctx) => {
    const rows = await listWorkspaceAssets(ctx.session.workspace.id, {
      type: input.type,
      limit: input.limit,
    });

    return {
      assets: rows.map((asset) => ({
        id: asset.id,
        projectId: asset.projectId ?? null,
        type: asset.type,
        mimeType: asset.mimeType ?? null,
        sizeBytes: asset.sizeBytes ?? null,
        width: asset.width ?? null,
        height: asset.height ?? null,
        durationSeconds: asset.durationSeconds ?? null,
        createdAt: toIso(asset.createdAt),
      })),
    };
  },
};
