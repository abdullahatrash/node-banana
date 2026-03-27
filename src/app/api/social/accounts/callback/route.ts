import { NextRequest, NextResponse } from "next/server";
import { isDatabaseConfigured } from "@/lib/db";
import { withApiPermission } from "@/lib/studio/authz";
import "@/lib/social/runtime-bootstrap";
import { getProvider } from "@/lib/social/provider-registry";
import { encryptToken } from "@/lib/social/crypto";
import {
  createOAuthSelectionSession,
  consumeOAuthState,
  upsertSocialAccount,
  OAuthStateNotFoundError,
  OAuthStateExpiredError,
} from "@/lib/social/repository";
import type { SocialPlatform } from "@/lib/db/schema";
import type { PageInfo } from "@/lib/social/provider-interface";
import { logger } from "@/utils/logger";

interface CallbackRequest {
  platform: string;
  code: string;
  state: string;
}

interface CallbackResponse {
  success: boolean;
  account?: Record<string, unknown>;
  pages?: PageInfo[];
  requiresPageSelection?: boolean;
  selectionSessionId?: string;
  error?: string;
}

const OAUTH_SELECTION_SESSION_TTL_MS = 10 * 60 * 1000;

export async function POST(
  request: NextRequest,
): Promise<NextResponse<CallbackResponse>> {
  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      { success: false, error: "DATABASE_URL is not configured." },
      { status: 503 },
    );
  }

  try {
    const result = await withApiPermission(request, {
      route: "/api/social/accounts/callback",
      permission: "social:connect",
    });

    if (!result.authorized) {
      return result.response;
    }

    const body = (await request.json()) as CallbackRequest;

    if (!body.platform?.trim() || !body.code?.trim() || !body.state?.trim()) {
      return NextResponse.json(
        { success: false, error: "Platform, code, and state are required." },
        { status: 400 },
      );
    }

    // Consume OAuth state (atomic — prevents replay)
    const oauthState = await consumeOAuthState(body.state);

    // Verify the platform matches the stored state
    if (oauthState.platform !== body.platform) {
      return NextResponse.json(
        { success: false, error: "Platform mismatch with OAuth state." },
        { status: 400 },
      );
    }

    const metadata =
      oauthState.metadata &&
      typeof oauthState.metadata === "object" &&
      !Array.isArray(oauthState.metadata)
        ? (oauthState.metadata as Record<string, unknown>)
        : null;
    const callbackUrl =
      metadata && typeof metadata.callbackUrl === "string"
        ? metadata.callbackUrl
        : null;

    if (!callbackUrl) {
      return NextResponse.json(
        { success: false, error: "OAuth callback URL is missing. Please reconnect." },
        { status: 400 },
      );
    }

    // Exchange code for tokens
    const provider = getProvider(body.platform);
    const authResult = await provider.authenticate({
      code: body.code,
      state: body.state,
      redirectUri: callbackUrl,
      codeVerifier: oauthState.codeVerifier ?? undefined,
    });

    // If provider requires page selection, return pages and a short-lived
    // server-side selection session instead of exposing tokens to the client.
    if (authResult.requiresPageSelection && provider.fetchPageInformation) {
      const pages = await provider.fetchPageInformation(authResult.accessToken);
      const session = await createOAuthSelectionSession({
        workspaceId: oauthState.workspaceId,
        platform: body.platform as SocialPlatform,
        accessTokenEncrypted: encryptToken(authResult.accessToken),
        refreshTokenEncrypted: authResult.refreshToken
          ? encryptToken(authResult.refreshToken)
          : undefined,
        accessTokenSecret: authResult.accessTokenSecret
          ? encryptToken(authResult.accessTokenSecret)
          : undefined,
        tokenExpiresAt: authResult.expiresIn
          ? new Date(Date.now() + authResult.expiresIn * 1000)
          : undefined,
        createdByUserId: result.session.user.id,
        expiresAt: new Date(Date.now() + OAUTH_SELECTION_SESSION_TTL_MS),
      });
      logger.info("system", "Social callback requires page selection", {
        workspaceId: oauthState.workspaceId,
        provider: body.platform,
        postId: null,
        accountId: null,
        dispatchKey: body.state,
        workflowRunRef: null,
      });

      return NextResponse.json({
        success: true,
        requiresPageSelection: true,
        pages,
        selectionSessionId: session.id,
      });
    }

    if (authResult.requiresPageSelection) {
      return NextResponse.json(
        {
          success: false,
          error: `${body.platform} requires page selection but provider does not support it.`,
        },
        { status: 500 },
      );
    }

    // Save the social account with encrypted tokens
    const account = await upsertSocialAccount({
      workspaceId: oauthState.workspaceId,
      platform: body.platform as SocialPlatform,
      platformUserId: authResult.platformUserId,
      displayName: authResult.displayName,
      username: authResult.username,
      avatarUrl: authResult.avatarUrl,
      accessTokenEncrypted: encryptToken(authResult.accessToken),
      refreshTokenEncrypted: authResult.refreshToken
        ? encryptToken(authResult.refreshToken)
        : undefined,
      accessTokenSecret: authResult.accessTokenSecret
        ? encryptToken(authResult.accessTokenSecret)
        : undefined,
      tokenExpiresAt: authResult.expiresIn
        ? new Date(Date.now() + authResult.expiresIn * 1000)
        : undefined,
      createdByUserId: result.session.user.id,
    });
    logger.info("system", "Social account connected", {
      workspaceId: oauthState.workspaceId,
      provider: body.platform,
      postId: null,
      accountId: account.id,
      dispatchKey: body.state,
      workflowRunRef: null,
    });

    // Strip encrypted fields from response
    const { accessTokenEncrypted, refreshTokenEncrypted, accessTokenSecret, ...safeAccount } = account;

    return NextResponse.json({
      success: true,
      account: safeAccount,
    });
  } catch (error) {
    if (
      error instanceof OAuthStateNotFoundError ||
      error instanceof OAuthStateExpiredError
    ) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 400 },
      );
    }

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to complete connection",
      },
      { status: 500 },
    );
  }
}
