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

export const runStartedSchema = z.object({
  runId: z.string(),
  status: z.string(),
});
export type RunStarted = z.infer<typeof runStartedSchema>;

export const runNodeProgressSchema = z.object({
  nodeId: z.string(),
  type: z.string(),
  status: z.string(),
  error: z.string().optional(),
});

export const runOutputSchema = z.object({
  nodeId: z.string(),
  assetId: z.string(),
  url: z.string().nullable(),
});

export const runStatusSchema = z.object({
  runId: z.string(),
  status: z.string(),
  progress: z.object({ nodes: z.array(runNodeProgressSchema) }),
  outputs: z.array(runOutputSchema),
  error: z
    .object({
      code: z.string().nullable(),
      message: z.string().nullable(),
    })
    .nullable(),
});
export type RunStatus = z.infer<typeof runStatusSchema>;

export const workspacesResponseSchema = z.object({
  workspaces: z.array(workspaceSchema),
});

export const socialAccountsResponseSchema = z.object({
  accounts: z.array(socialAccountSchema),
});

export const assetsResponseSchema = z.object({
  assets: z.array(assetSchema),
});

export const assetUploadResultSchema = z.object({
  assetId: z.string(),
  downloadUrl: z.string(),
  expiresInSeconds: z.number().nullable().optional(),
});
export type AssetUploadResult = z.infer<typeof assetUploadResultSchema>;

export const assetDownloadUrlResultSchema = assetUploadResultSchema;
export type AssetDownloadUrlResult = z.infer<typeof assetDownloadUrlResultSchema>;

export const postSummarySchema = z.object({
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
export type PostSummary = z.infer<typeof postSummarySchema>;

export const postsResponseSchema = z.object({
  posts: z.array(postSummarySchema),
});

export const postStatusSchema = z.object({
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
export type PostStatus = z.infer<typeof postStatusSchema>;

export const createPostResultSchema = z.object({
  postId: z.string(),
  status: z.string(),
  scheduledAt: z.string().nullable(),
});
export type CreatePostResult = z.infer<typeof createPostResultSchema>;
