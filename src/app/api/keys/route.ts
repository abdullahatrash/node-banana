import { NextRequest, NextResponse } from "next/server";

import { listProviderKeys, upsertProviderKey } from "@/lib/byok/repository";
import { isByokProvider } from "@/lib/byok/providers";
import { validateProviderKey } from "@/lib/byok/validation";
import { withStudioAuth } from "@/lib/studio/withStudioAuth";
import type { ProviderKeySummary } from "@/lib/byok/repository";
import { requireGovernanceStepUp } from "@/lib/governance/step-up-http";

const ROUTE = "/api/keys";

interface KeysListResponse {
  success: boolean;
  keys?: ProviderKeySummary[];
  error?: string;
}

interface KeySaveResponse {
  success: boolean;
  key?: ProviderKeySummary;
  error?: string;
}

/** List the current workspace's BYOK provider keys — masked hints only. */
export const GET = withStudioAuth<undefined>(
  { route: ROUTE, action: "read", permission: "workspaces:read" },
  async (
    _request: NextRequest,
    authz,
  ): Promise<NextResponse<KeysListResponse>> => {
    const keys = await listProviderKeys(authz.workspaceId);
    return NextResponse.json({ success: true, keys });
  },
);

/**
 * Save (create or rotate) a provider key. The key is validated with a live,
 * cheap authenticated call to the provider before it is ever persisted — an
 * invalid key is rejected with the provider's own error message and never
 * reaches the vault.
 */
export const POST = withStudioAuth<undefined>(
  { route: ROUTE, action: "write", permission: "workspaces:write" },
  async (
    request: NextRequest,
    authz,
  ): Promise<NextResponse<KeySaveResponse>> => {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      body = null;
    }

    const rawProvider =
      body && typeof body === "object" && "provider" in body
        ? (body as { provider?: unknown }).provider
        : undefined;
    const rawApiKey =
      body && typeof body === "object" && "apiKey" in body
        ? (body as { apiKey?: unknown }).apiKey
        : undefined;

    const provider = typeof rawProvider === "string" ? rawProvider : "";
    const apiKey = typeof rawApiKey === "string" ? rawApiKey.trim() : "";

    if (!isByokProvider(provider)) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Unknown provider. Must be one of: gemini, openai, anthropic, kie, fal, replicate, wavespeed.",
        },
        { status: 400 },
      );
    }

    if (!apiKey) {
      return NextResponse.json(
        { success: false, error: "An API key is required." },
        { status: 400 },
      );
    }

    const stepUpDenied = await requireGovernanceStepUp({ request, workspaceId: authz.workspaceId, userId: authz.userId, purpose: "credential.replace", resourceId: provider });
    if (stepUpDenied) return stepUpDenied as NextResponse<KeySaveResponse>;

    const validation = await validateProviderKey(provider, apiKey);
    if (!validation.ok) {
      return NextResponse.json(
        { success: false, error: validation.error },
        { status: 422 },
      );
    }

    const key = await upsertProviderKey({
      workspaceId: authz.workspaceId,
      provider,
      rawKey: apiKey,
      createdByUserId: authz.userId,
    });

    return NextResponse.json({ success: true, key });
  },
);
