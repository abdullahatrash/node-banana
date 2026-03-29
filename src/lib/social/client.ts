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
  additionalSettings?: Record<string, unknown> | null;
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
  accountId?: string,
): Promise<{ authUrl: string }> {
  const data = await socialFetch("/api/social/accounts/connect", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      platform,
      ...(accountId ? { accountId } : {}),
    }),
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
  selectionSessionId?: string;
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
    selectionSessionId: data.selectionSessionId as string | undefined,
  };
}

export async function selectPage(
  platform: string,
  pageId: string,
  selectionSessionId: string,
): Promise<SocialAccount> {
  const data = await socialFetch("/api/social/accounts/select-page", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ platform, pageId, selectionSessionId }),
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
  force = false,
): Promise<void> {
  const qs = force ? "?force=true" : "";
  await socialFetch(`/api/social/accounts/${accountId}${qs}`, {
    method: "DELETE",
  });
}

export async function updateSocialAccount(
  accountId: string,
  input: {
    displayName?: string;
    disabled?: boolean;
    additionalSettings?: Record<string, unknown> | null;
  },
): Promise<SocialAccount> {
  const data = await socialFetch(`/api/social/accounts/${accountId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return data.account as SocialAccount;
}

// ---------------------------------------------------------------------------
// Posts
// ---------------------------------------------------------------------------

export async function listSocialPosts(filters?: {
  status?: SocialPostStatus;
  socialAccountId?: string;
  startDate?: string;
  endDate?: string;
  limit?: number;
  offset?: number;
}): Promise<SocialPost[]> {
  const params = new URLSearchParams();
  if (filters?.status) params.set("status", filters.status);
  if (filters?.socialAccountId) params.set("socialAccountId", filters.socialAccountId);
  if (filters?.startDate) params.set("startDate", filters.startDate);
  if (filters?.endDate) params.set("endDate", filters.endDate);
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

// ---------------------------------------------------------------------------
// Events / Ops
// ---------------------------------------------------------------------------

export interface SocialEvent {
  id: string;
  workspaceId: string;
  eventType: string;
  severity: string;
  message: string;
  createdAt: string;
  readAt?: string | null;
  readByCurrentUser?: boolean;
}

export async function listSocialEvents(filters?: {
  userFacing?: boolean;
  unreadOnly?: boolean;
  perUserReads?: boolean;
  limit?: number;
  offset?: number;
}): Promise<SocialEvent[]> {
  const params = new URLSearchParams();
  if (filters?.userFacing !== undefined) {
    params.set("userFacing", String(filters.userFacing));
  }
  if (filters?.unreadOnly !== undefined) {
    params.set("unreadOnly", String(filters.unreadOnly));
  }
  if (filters?.perUserReads !== undefined) {
    params.set("perUserReads", String(filters.perUserReads));
  }
  if (filters?.limit) params.set("limit", String(filters.limit));
  if (filters?.offset) params.set("offset", String(filters.offset));

  const qs = params.toString();
  const data = await socialFetch(`/api/social/events${qs ? `?${qs}` : ""}`);
  return (data.events as SocialEvent[]) || [];
}

export async function markSocialEventRead(
  eventId: string,
  options?: { perUserReads?: boolean },
): Promise<SocialEvent> {
  const params = new URLSearchParams();
  if (options?.perUserReads !== undefined) {
    params.set("perUserReads", String(options.perUserReads));
  }
  const qs = params.toString();
  const data = await socialFetch(
    `/api/social/events/${eventId}/read${qs ? `?${qs}` : ""}`,
    { method: "POST" },
  );
  return data.event as SocialEvent;
}

export async function markSocialEventUnread(
  eventId: string,
  options?: { perUserReads?: boolean },
): Promise<SocialEvent> {
  const params = new URLSearchParams();
  if (options?.perUserReads !== undefined) {
    params.set("perUserReads", String(options.perUserReads));
  }
  const qs = params.toString();
  const data = await socialFetch(
    `/api/social/events/${eventId}/read${qs ? `?${qs}` : ""}`,
    { method: "DELETE" },
  );
  return data.event as SocialEvent;
}

export interface SocialWebhook {
  id: string;
  workspaceId: string;
  targetUrl: string;
  enabled: boolean;
  createdByUserId?: string;
  createdAt: string;
  updatedAt?: string;
}

export async function listSocialWebhooks(): Promise<SocialWebhook[]> {
  const data = await socialFetch("/api/social/webhooks");
  return (data.webhooks as SocialWebhook[]) || [];
}

export async function createSocialWebhook(input: {
  targetUrl: string;
  name?: string;
  enabled?: boolean;
  filters?: Record<string, unknown>;
}): Promise<{ webhook: SocialWebhook; signingSecret?: string }> {
  const data = await socialFetch("/api/social/webhooks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return {
    webhook: data.webhook as SocialWebhook,
    signingSecret: data.signingSecret as string | undefined,
  };
}

export async function updateSocialWebhook(
  webhookId: string,
  input: {
    targetUrl?: string;
    enabled?: boolean;
    subscription?: {
      name?: string | null;
      enabled?: boolean;
      filters?: Record<string, unknown> | null;
    };
  },
): Promise<{
  webhook: SocialWebhook;
  subscription?: Record<string, unknown> | null;
}> {
  const data = await socialFetch(`/api/social/webhooks/${webhookId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return {
    webhook: data.webhook as SocialWebhook,
    subscription: data.subscription as Record<string, unknown> | null | undefined,
  };
}

export async function deleteSocialWebhook(webhookId: string): Promise<void> {
  await socialFetch(`/api/social/webhooks/${webhookId}`, {
    method: "DELETE",
  });
}

export interface AutomationRule {
  id: string;
  workspaceId: string;
  name: string;
  triggerSource: string;
  enabled: boolean;
  repeatIntervalSeconds?: number | null;
  maxRuns?: number | null;
  totalRuns?: number;
  actionType?: string | null;
  actionConfig?: Record<string, unknown> | null;
  triggerFilters?: Record<string, unknown> | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface AutomationTask {
  id: string;
  workspaceId: string;
  ruleId: string;
  taskKey: string;
  runIndex: number;
  state: "pending" | "claimed" | "succeeded" | "failed" | "cancelled";
  dueAt?: string | null;
  claimedBy?: string | null;
  errorMessage?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export async function listAutomationRules(): Promise<AutomationRule[]> {
  const data = await socialFetch("/api/social/automation/rules");
  return (data.rules as AutomationRule[]) || [];
}

export async function getAutomationRule(ruleId: string): Promise<AutomationRule> {
  const data = await socialFetch(`/api/social/automation/rules/${ruleId}`);
  return data.rule as AutomationRule;
}

export async function updateAutomationRule(
  ruleId: string,
  input: Record<string, unknown>,
): Promise<AutomationRule> {
  const data = await socialFetch(`/api/social/automation/rules/${ruleId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return data.rule as AutomationRule;
}

export async function deleteAutomationRule(ruleId: string): Promise<void> {
  await socialFetch(`/api/social/automation/rules/${ruleId}`, {
    method: "DELETE",
  });
}

export async function listAutomationTasks(): Promise<AutomationTask[]> {
  const data = await socialFetch("/api/social/automation/tasks");
  return (data.tasks as AutomationTask[]) || [];
}

export async function getAutomationTask(taskId: string): Promise<AutomationTask> {
  const data = await socialFetch(`/api/social/automation/tasks/${taskId}`);
  return data.task as AutomationTask;
}

export async function updateAutomationTask(
  taskId: string,
  input: Record<string, unknown>,
): Promise<AutomationTask> {
  const data = await socialFetch(`/api/social/automation/tasks/${taskId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return data.task as AutomationTask;
}

export async function deleteAutomationTask(taskId: string): Promise<void> {
  await socialFetch(`/api/social/automation/tasks/${taskId}`, {
    method: "DELETE",
  });
}

export async function getSocialNotificationPreferences(): Promise<{
  inAppEnabled: boolean;
  emailEnabled: boolean;
  webhookEnabled: boolean;
  muteAll: boolean;
  preferences: Record<string, unknown> | null;
}> {
  const data = await socialFetch("/api/social/notifications/preferences");
  return data.preferences as {
    inAppEnabled: boolean;
    emailEnabled: boolean;
    webhookEnabled: boolean;
    muteAll: boolean;
    preferences: Record<string, unknown> | null;
  };
}

export async function updateSocialNotificationPreferences(input: {
  inAppEnabled?: boolean;
  emailEnabled?: boolean;
  webhookEnabled?: boolean;
  muteAll?: boolean;
  preferences?: Record<string, unknown> | null;
}) {
  const data = await socialFetch("/api/social/notifications/preferences", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return data.preferences as {
    inAppEnabled: boolean;
    emailEnabled: boolean;
    webhookEnabled: boolean;
    muteAll: boolean;
    preferences: Record<string, unknown> | null;
  };
}
