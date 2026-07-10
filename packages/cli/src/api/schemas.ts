import { z } from "zod";

/**
 * Minimal Zod schemas mirroring the public API v1 response shapes.
 *
 * These are intentionally *duplicated* from the server's tool registry rather
 * than imported: the registry tools pull in server-only modules (`@/lib/db`,
 * repositories) that must never enter the CLI bundle. Keeping a tiny local copy
 * keeps the CLI a pure API client while still validating every payload it
 * consumes — a shape drift surfaces as a clear `invalid_response` error.
 */

export const workspaceSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
});
export type Workspace = z.infer<typeof workspaceSchema>;

export const socialAccountSchema = z.object({
  id: z.string(),
  platform: z.string(),
  platformUserId: z.string(),
  displayName: z.string(),
  username: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  tokenExpiresAt: z.string().nullable(),
  requiresReauth: z.boolean(),
  disabled: z.boolean(),
  createdAt: z.string(),
});
export type SocialAccount = z.infer<typeof socialAccountSchema>;

export const assetTypeSchema = z.enum([
  "image",
  "video",
  "audio",
  "model3d",
  "workflow",
]);
export type AssetType = z.infer<typeof assetTypeSchema>;

export const assetSchema = z.object({
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
export type Asset = z.infer<typeof assetSchema>;

export const workspacesResponseSchema = z.object({
  workspaces: z.array(workspaceSchema),
});

export const socialAccountsResponseSchema = z.object({
  accounts: z.array(socialAccountSchema),
});

export const assetsResponseSchema = z.object({
  assets: z.array(assetSchema),
});
