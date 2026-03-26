/**
 * Social Hub client — frontend helper functions for social API routes.
 * Follows the same pattern as src/lib/studio/client.ts.
 */

import { getActiveWorkspaceId, StudioApiError } from "@/lib/studio/client";
import type { ProviderCapabilities } from "@/lib/social/provider-interface";
import type { SocialPlatform, SocialPostStatus } from "@/lib/db/schema";

// ---------------------------------------------------------------------------
// Internal helpers (reuse studio client patterns)
// ---------------------------------------------------------------------------

type JsonRecord = Record<string, unknown>;

function mergeHeaders(init?: RequestInit): Headers {
  const headers = new Headers(init?.headers || {});
  const workspaceId = getActiveWorkspaceId();
  if (workspaceId) {
    headers.set("x-workspace-id", workspaceId);
  }
  return headers;
}

async function socialFetch(
  path: string,
  init?: RequestInit,
): Promise<JsonRecord> {
  const workspaceId = getActiveWorkspaceId();
  if (!workspaceId) {
    throw new StudioApiError(403, "Select a workspace to continue.");
  }

  const response = await fetch(path, {
    ...init,
    headers: mergeHeaders(init),
  });

  let data: unknown = null;
  try {
    data = await response.json();
  } catch {
    throw new StudioApiError(
      response.status,
      `Request failed with status ${response.status}`,
    );
  }

  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new StudioApiError(response.status, "Invalid API response");
  }

  const record = data as JsonRecord;
  if (record.success === false) {
    const message =
      typeof record.error === "string" ? record.error : "Request failed";
    throw new StudioApiError(response.status, message);
  }

  return record;
}

// ---------------------------------------------------------------------------
// Types (safe API response shapes — no encrypted tokens)
// ---------------------------------------------------------------------------

export interface SocialAccount {
  id: string;
  workspaceId: string;
  platform: SocialPlatform;
  platformUserId: string;
  displayName: string;
  username?: string | null;
  avatarUrl?: string | null;
  tokenExpiresAt?: string | null;
  requiresReauth: boolean;
  disabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SocialPost {
  id: string;
  workspaceId: string;
  socialAccountId: string;
  status: SocialPostStatus;
  content?: string | null;
  mediaUrls?: Array<{ type: string; url: string; alt?: string }> | null;
  platformSettings?: Record<string, unknown> | null;
  scheduledAt?: string | null;
  publishedAt?: string | null;
  platformPostId?: string | null;
  platformPostUrl?: string | null;
  errorMessage?: string | null;
  retryCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface PageInfo {
  id: string;
  name: string;
  picture?: string;
  username?: string;
}

// ---------------------------------------------------------------------------
// Providers
// ---------------------------------------------------------------------------

export async function listSocialProviders(): Promise<ProviderCapabilities[]> {
  const data = await socialFetch("/api/social/providers");
  return (data.providers as ProviderCapabilities[]) || [];
}

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

export async function listSocialAccounts(): Promise<SocialAccount[]> {
  const data = await socialFetch("/api/social/accounts");
  return (data.accounts as SocialAccount[]) || [];
}

export async function connectSocialAccount(
  platform: string,
): Promise<{ authUrl: string }> {
  const data = await socialFetch("/api/social/accounts/connect", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ platform }),
  });
  return { authUrl: data.authUrl as string };
}

export async function handleOAuthCallback(
  platform: string,
  code: string,
  state: string,
): Promise<{
  account?: SocialAccount;
  pages?: PageInfo[];
  requiresPageSelection?: boolean;
}> {
  const data = await socialFetch("/api/social/accounts/callback", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ platform, code, state }),
  });

  return {
    account: data.account as SocialAccount | undefined,
    pages: data.pages as PageInfo[] | undefined,
    requiresPageSelection: data.requiresPageSelection as boolean | undefined,
  };
}

export async function selectPage(
  platform: string,
  pageId: string,
  accessToken: string,
  refreshToken?: string,
  expiresIn?: number,
): Promise<SocialAccount> {
  const data = await socialFetch("/api/social/accounts/select-page", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ platform, pageId, accessToken, refreshToken, expiresIn }),
  });
  return data.account as SocialAccount;
}

export async function getSocialAccount(
  accountId: string,
): Promise<SocialAccount> {
  const data = await socialFetch(`/api/social/accounts/${accountId}`);
  return data.account as SocialAccount;
}

export async function disconnectSocialAccount(
  accountId: string,
): Promise<void> {
  await socialFetch(`/api/social/accounts/${accountId}`, {
    method: "DELETE",
  });
}

// ---------------------------------------------------------------------------
// Posts
// ---------------------------------------------------------------------------

export async function listSocialPosts(filters?: {
  status?: SocialPostStatus;
  socialAccountId?: string;
  limit?: number;
  offset?: number;
}): Promise<SocialPost[]> {
  const params = new URLSearchParams();
  if (filters?.status) params.set("status", filters.status);
  if (filters?.socialAccountId) params.set("socialAccountId", filters.socialAccountId);
  if (filters?.limit) params.set("limit", String(filters.limit));
  if (filters?.offset) params.set("offset", String(filters.offset));

  const qs = params.toString();
  const data = await socialFetch(`/api/social/posts${qs ? `?${qs}` : ""}`);
  return (data.posts as SocialPost[]) || [];
}

export async function createSocialPost(input: {
  socialAccountId: string;
  content?: string;
  mediaUrls?: Array<{ type: string; url: string; alt?: string }>;
  platformSettings?: Record<string, unknown>;
  scheduledAt?: string;
  studioAssetId?: string;
}): Promise<SocialPost> {
  const data = await socialFetch("/api/social/posts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return data.post as SocialPost;
}

export async function getSocialPost(postId: string): Promise<SocialPost> {
  const data = await socialFetch(`/api/social/posts/${postId}`);
  return data.post as SocialPost;
}

export async function updateSocialPost(
  postId: string,
  input: {
    content?: string;
    mediaUrls?: Array<{ type: string; url: string; alt?: string }>;
    platformSettings?: Record<string, unknown>;
    scheduledAt?: string | null;
  },
): Promise<SocialPost> {
  const data = await socialFetch(`/api/social/posts/${postId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return data.post as SocialPost;
}

export async function deleteSocialPost(postId: string): Promise<void> {
  await socialFetch(`/api/social/posts/${postId}`, { method: "DELETE" });
}

export async function publishSocialPost(postId: string): Promise<SocialPost> {
  const data = await socialFetch(`/api/social/posts/${postId}/publish`, {
    method: "POST",
  });
  return data.post as SocialPost;
}

export async function retrySocialPost(postId: string): Promise<SocialPost> {
  // Retry uses the same publish endpoint — it accepts "failed" posts too
  return publishSocialPost(postId);
}
