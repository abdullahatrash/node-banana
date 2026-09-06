import { NextRequest, NextResponse } from "next/server";
import { isDatabaseConfigured } from "@/lib/db";
import { withApiPermission } from "@/lib/studio/authz";
import "@/lib/social/runtime-bootstrap";
import { getProvider } from "@/lib/social/provider-registry";
import { decryptToken, encryptToken } from "@/lib/social/crypto";
import {
  consumeOAuthSelectionSession,
  getOAuthSelectionSession,
  upsertSocialAccount,
  SocialAccountQuotaExceededError,
  OAuthSelectionSessionNotFoundError,
  OAuthSelectionSessionExpiredError,
} from "@/lib/social/repository";
import { getWorkspaceChannelEntitlement } from "@/lib/commercial/channel-entitlement";
import { quotaExceededPayload } from "@/lib/social/limits";
import { withLinkedInAuthorKind } from "@/lib/social/linkedin-author-kind";
import type { SocialPlatform } from "@/lib/db/schema";
import { logger } from "@/utils/logger";

interface SelectPageRequest {
  platform: string;
  pageId: string;
  selectionSessionId: string;
}

interface SelectPageResponse {
  success: boolean;
  account?: Record<string, unknown>;
  error?: string;
  code?: string;
  billingUrl?: string;
  section?: string;
  current?: number;
  limit?: number;
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

    const selectionSession = await getOAuthSelectionSession({
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

    // Consume only after selection is validated so users can retry selection safely.
    const consumedSession = await consumeOAuthSelectionSession({
      selectionSessionId: body.selectionSessionId,
      workspaceId: result.session.workspace.id,
      platform: body.platform as SocialPlatform,
    });

    // Use page-specific token if available, otherwise use the original token
    const accessTokenEncrypted = selectedPage.accessToken
      ? encryptToken(selectedPage.accessToken)
      : consumedSession.accessTokenEncrypted;

    const entitlement = await getWorkspaceChannelEntitlement(result.session.workspace.id);
    const account = await upsertSocialAccount({
      workspaceId: result.session.workspace.id,
      platform: body.platform as SocialPlatform,
      platformUserId: selectedPage.id,
      displayName: selectedPage.name,
      username: selectedPage.username,
      avatarUrl: selectedPage.picture,
      accessTokenEncrypted,
      refreshTokenEncrypted: consumedSession.refreshTokenEncrypted ?? undefined,
      accessTokenSecret: consumedSession.accessTokenSecret ?? undefined,
      tokenExpiresAt: consumedSession.tokenExpiresAt ?? undefined,
      additionalSettings:
        body.platform === "linkedin"
          ? withLinkedInAuthorKind(undefined, "organization")
          : undefined,
      createdByUserId: result.session.user.id,
      maxActiveChannels: entitlement.connectedChannels,
    });
    logger.info("system", "Social page selection completed", {
      workspaceId: result.session.workspace.id,
      provider: body.platform,
      postId: null,
      accountId: account.id,
      dispatchKey: body.selectionSessionId,
      workflowRunRef: null,
    });

    const {
      accessTokenEncrypted: _accessTokenEncrypted,
      refreshTokenEncrypted: _refreshTokenEncrypted,
      accessTokenSecret: _accessTokenSecret,
      ...safeAccount
    } = account;

    return NextResponse.json({ success: true, account: safeAccount });
  } catch (error) {
    if (error instanceof SocialAccountQuotaExceededError) {
      return NextResponse.json(
        quotaExceededPayload({ section: "channels", current: error.current, limit: error.limit }),
        { status: 402 },
      );
    }
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
