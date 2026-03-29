import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { isDatabaseConfigured } from "@/lib/db";
import { withApiPermission } from "@/lib/studio/authz";
import "@/lib/social/runtime-bootstrap";
import { getProvider, isProviderRegistered } from "@/lib/social/provider-registry";
import { getSocialPlanLimits, quotaExceededPayload } from "@/lib/social/limits";
import {
  countActiveSocialAccounts,
  createOAuthState,
  getSocialAccount,
  SocialAccountNotFoundError,
} from "@/lib/social/repository";
import type { SocialPlatform } from "@/lib/db/schema";
import { logger } from "@/utils/logger";

interface ConnectRequest {
  platform: string;
  accountId?: string;
}

interface ConnectResponse {
  success: boolean;
  authUrl?: string;
  error?: string;
  code?: string;
  billingUrl?: string;
}

const OAUTH_STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes

export async function POST(
  request: NextRequest,
): Promise<NextResponse<ConnectResponse>> {
  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      { success: false, error: "DATABASE_URL is not configured." },
      { status: 503 },
    );
  }

  try {
    const result = await withApiPermission(request, {
      route: "/api/social/accounts/connect",
      permission: "social:connect",
    });

    if (!result.authorized) {
      return result.response;
    }

    const body = (await request.json()) as ConnectRequest;

    if (!body.platform?.trim()) {
      return NextResponse.json(
        { success: false, error: "Platform is required." },
        { status: 400 },
      );
    }

    if (!isProviderRegistered(body.platform)) {
      return NextResponse.json(
        { success: false, error: `Platform "${body.platform}" is not available.` },
        { status: 400 },
      );
    }

    let reconnectAccountId: string | null = null;
    if (body.accountId?.trim()) {
      const reconnectAccount = await getSocialAccount(
        result.session.workspace.id,
        body.accountId.trim(),
      );
      if (reconnectAccount.platform !== body.platform) {
        return NextResponse.json(
          {
            success: false,
            error:
              "Reconnect platform does not match the selected channel platform.",
          },
          { status: 400 },
        );
      }
      reconnectAccountId = reconnectAccount.id;
    } else {
      const limits = getSocialPlanLimits(result.session.planTier);
      const activeChannels = await countActiveSocialAccounts(
        result.session.workspace.id,
      );
      if (activeChannels >= limits.channels) {
        return NextResponse.json(
          quotaExceededPayload({
            section: "channels",
            current: activeChannels,
            limit: limits.channels,
          }),
          { status: 402 },
        );
      }
    }

    const provider = getProvider(body.platform);
    const origin =
      request.headers.get("origin") ||
      process.env.NEXT_PUBLIC_APP_URL ||
      "http://localhost:3000";
    const callbackUrl = `${origin}/api/social/accounts/callback`;

    const authResult = await provider.generateAuthUrl(callbackUrl);

    // Store OAuth state for CSRF protection
    await createOAuthState({
      workspaceId: result.session.workspace.id,
      platform: body.platform as SocialPlatform,
      state: authResult.state,
      codeVerifier: authResult.codeVerifier,
      metadata: {
        callbackUrl,
        ...(reconnectAccountId ? { reconnectAccountId } : {}),
      },
      expiresAt: new Date(Date.now() + OAUTH_STATE_TTL_MS),
    });
    logger.info("system", "Social connect OAuth flow initialized", {
      workspaceId: result.session.workspace.id,
      provider: body.platform,
      postId: null,
      accountId: null,
      dispatchKey: authResult.state,
      workflowRunRef: null,
    });

    return NextResponse.json({ success: true, authUrl: authResult.url });
  } catch (error) {
    if (error instanceof SocialAccountNotFoundError) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 404 },
      );
    }

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to initiate connection",
      },
      { status: 500 },
    );
  }
}
