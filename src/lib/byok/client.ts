/**
 * BYOK provider-key client — frontend helpers for the workspace-settings UI.
 * Reuses the studio client's workspace scoping and error type, following the
 * same shape as `@/lib/api-tokens/client`.
 */

import { getActiveWorkspaceId, StudioApiError } from "@/lib/studio/client";
import { executeGovernanceCommand } from "@/lib/governance/client";
import type { ByokProvider } from "./providers";

export interface ProviderKeySummaryView {
  provider: ByokProvider;
  /** Non-secret display hint, e.g. "sk-…abc4". Never the raw key. */
  hint: string;
  lastValidatedAt: string | null;
  updatedAt: string;
}

export interface ProviderKeyStepUpChallenge {
  challengeId: string;
  expiresAt: string;
}

export type ProviderKeyStepUpVerification =
  | { verified: true; stepUpToken: string; expiresAt: string }
  | { verified: false; attemptsRemaining: number };

type JsonRecord = Record<string, unknown>;

function mergeHeaders(init?: RequestInit): Headers {
  const headers = new Headers(init?.headers || {});
  const workspaceId = getActiveWorkspaceId();
  if (workspaceId) {
    headers.set("x-workspace-id", workspaceId);
  }
  return headers;
}

async function keysFetch(
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

export async function listProviderKeysRequest(): Promise<
  ProviderKeySummaryView[]
> {
  const record = await keysFetch("/api/keys");
  const keys = record.keys;
  return Array.isArray(keys) ? (keys as ProviderKeySummaryView[]) : [];
}

export async function saveProviderKeyRequest(
  provider: ByokProvider,
  apiKey: string,
  stepUpToken: string,
): Promise<ProviderKeySummaryView> {
  const record = await keysFetch("/api/keys", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-step-up-token": stepUpToken,
    },
    body: JSON.stringify({ provider, apiKey }),
  });
  return record.key as ProviderKeySummaryView;
}

/** Begin a short-lived governance challenge scoped to this exact provider. */
export function beginProviderKeyStepUpRequest(
  provider: ByokProvider,
): Promise<ProviderKeyStepUpChallenge> {
  return executeGovernanceCommand<ProviderKeyStepUpChallenge>({
    type: "begin_step_up",
    purpose: "credential.replace",
    resourceId: provider,
  });
}

/** Verify the challenge and receive the opaque token required by POST /api/keys. */
export function verifyProviderKeyStepUpRequest(
  challengeId: string,
  code: string,
): Promise<ProviderKeyStepUpVerification> {
  return executeGovernanceCommand<ProviderKeyStepUpVerification>({
    type: "verify_step_up",
    challengeId,
    code,
  });
}

export async function deleteProviderKeyRequest(
  provider: ByokProvider,
): Promise<void> {
  await keysFetch(`/api/keys/${encodeURIComponent(provider)}`, {
    method: "DELETE",
  });
}
