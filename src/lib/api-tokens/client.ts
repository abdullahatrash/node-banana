/**
 * API tokens client — frontend helpers for the workspace-settings UI.
 * Reuses the studio client's workspace scoping and error type.
 */

import { getActiveWorkspaceId, StudioApiError } from "@/lib/studio/client";

export interface ApiTokenSummaryView {
  id: string;
  name: string;
  prefix: string;
  revoked: boolean;
  lastUsedAt: string | null;
  createdAt: string;
}

export interface CreatedApiTokenView {
  id: string;
  name: string;
  /** Raw secret — shown to the user exactly once. */
  token: string;
  prefix: string;
  createdAt: string;
}

type JsonRecord = Record<string, unknown>;

function mergeHeaders(init?: RequestInit): Headers {
  const headers = new Headers(init?.headers || {});
  const workspaceId = getActiveWorkspaceId();
  if (workspaceId) {
    headers.set("x-workspace-id", workspaceId);
  }
  return headers;
}

async function tokensFetch(
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
  if (!response.ok || record.success === false) {
    const message =
      typeof record.error === "string" ? record.error : "Request failed";
    throw new StudioApiError(response.status, message);
  }

  return record;
}

export async function listApiTokensRequest(): Promise<ApiTokenSummaryView[]> {
  const record = await tokensFetch("/api/tokens");
  const tokens = record.tokens;
  return Array.isArray(tokens) ? (tokens as ApiTokenSummaryView[]) : [];
}

export async function createApiTokenRequest(
  name: string,
): Promise<CreatedApiTokenView> {
  const record = await tokensFetch("/api/tokens", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name }),
  });
  return record.token as CreatedApiTokenView;
}

export async function revokeApiTokenRequest(tokenId: string): Promise<void> {
  await tokensFetch(`/api/tokens/${encodeURIComponent(tokenId)}`, {
    method: "DELETE",
  });
}
