import { NextRequest, NextResponse } from "next/server";
import { isDatabaseConfigured } from "@/lib/db";
import { withApiPermission } from "@/lib/studio/authz";
import { getProvider } from "@/lib/social/provider-registry";
import { encryptToken } from "@/lib/social/crypto";
import {
  consumeOAuthState,
  upsertSocialAccount,
  OAuthStateNotFoundError,
  OAuthStateExpiredError,
} from "@/lib/social/repository";
import type { SocialPlatform } from "@/lib/db/schema";
import type { PageInfo } from "@/lib/social/provider-interface";

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
  error?: string;
}

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

    // Exchange code for tokens
    const provider = getProvider(body.platform);
    const authResult = await provider.authenticate({
      code: body.code,
      codeVerifier: oauthState.codeVerifier ?? undefined,
      state: body.state,
    });

    // If provider requires page selection, return pages without saving yet
    if (authResult.requiresPageSelection && provider.fetchPageInformation) {
      const pages = await provider.fetchPageInformation(authResult.accessToken);
      return NextResponse.json({
        success: true,
        requiresPageSelection: true,
        pages,
        // Temporarily store the token info for the select-page step
        account: {
          platform: body.platform,
          platformUserId: authResult.platformUserId,
          displayName: authResult.displayName,
          accessToken: authResult.accessToken, // Will be encrypted on final save
          refreshToken: authResult.refreshToken,
          expiresIn: authResult.expiresIn,
        },
      });
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
