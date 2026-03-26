import { NextRequest, NextResponse } from "next/server";
import { isDatabaseConfigured } from "@/lib/db";
import { withApiPermission } from "@/lib/studio/authz";
import { getProvider } from "@/lib/social/provider-registry";
import { decryptToken, encryptToken } from "@/lib/social/crypto";
import {
  consumeOAuthSelectionSession,
  upsertSocialAccount,
  OAuthSelectionSessionNotFoundError,
  OAuthSelectionSessionExpiredError,
} from "@/lib/social/repository";
import type { SocialPlatform } from "@/lib/db/schema";

interface SelectPageRequest {
  platform: string;
  pageId: string;
  selectionSessionId: string;
}

interface SelectPageResponse {
  success: boolean;
  account?: Record<string, unknown>;
  error?: string;
}

export async function POST(
  request: NextRequest,
): Promise<NextResponse<SelectPageResponse>> {
  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      { success: false, error: "DATABASE_URL is not configured." },
      { status: 503 },
    );
  }

  try {
    const result = await withApiPermission(request, {
      route: "/api/social/accounts/select-page",
      permission: "social:connect",
    });

    if (!result.authorized) {
      return result.response;
    }

    const body = (await request.json()) as SelectPageRequest;

    if (
      !body.platform?.trim() ||
      !body.pageId?.trim() ||
      !body.selectionSessionId?.trim()
    ) {
      return NextResponse.json(
        {
          success: false,
          error: "Platform, pageId, and selectionSessionId are required.",
        },
        { status: 400 },
      );
    }

    const provider = getProvider(body.platform);

    if (!provider.fetchPageInformation) {
      return NextResponse.json(
        { success: false, error: `${body.platform} does not support page selection.` },
        { status: 400 },
      );
    }

    const selectionSession = await consumeOAuthSelectionSession({
      selectionSessionId: body.selectionSessionId,
      workspaceId: result.session.workspace.id,
      platform: body.platform as SocialPlatform,
    });
    const accessToken = decryptToken(selectionSession.accessTokenEncrypted);

    // Fetch page-specific details (may include page-level access token)
    const pages = await provider.fetchPageInformation(accessToken);
    const selectedPage = pages.find((p) => p.id === body.pageId);

    if (!selectedPage) {
      return NextResponse.json(
        { success: false, error: "Selected page not found." },
        { status: 404 },
      );
    }

    // Use page-specific token if available, otherwise use the original token
    const accessTokenEncrypted = selectedPage.accessToken
      ? encryptToken(selectedPage.accessToken)
      : selectionSession.accessTokenEncrypted;

    const account = await upsertSocialAccount({
      workspaceId: result.session.workspace.id,
      platform: body.platform as SocialPlatform,
      platformUserId: selectedPage.id,
      displayName: selectedPage.name,
      username: selectedPage.username,
      avatarUrl: selectedPage.picture,
      accessTokenEncrypted,
      refreshTokenEncrypted: selectionSession.refreshTokenEncrypted ?? undefined,
      accessTokenSecret: selectionSession.accessTokenSecret ?? undefined,
      tokenExpiresAt: selectionSession.tokenExpiresAt ?? undefined,
      createdByUserId: result.session.user.id,
    });

    const {
      accessTokenEncrypted: _accessTokenEncrypted,
      refreshTokenEncrypted: _refreshTokenEncrypted,
      accessTokenSecret: _accessTokenSecret,
      ...safeAccount
    } = account;

    return NextResponse.json({ success: true, account: safeAccount });
  } catch (error) {
    if (
      error instanceof OAuthSelectionSessionNotFoundError ||
      error instanceof OAuthSelectionSessionExpiredError
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
            : "Failed to complete page selection",
      },
      { status: 500 },
    );
  }
}
