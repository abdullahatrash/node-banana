import { NextRequest, NextResponse } from "next/server";
import { isDatabaseConfigured } from "@/lib/db";
import { withApiPermission } from "@/lib/studio/authz";
import "@/lib/social/runtime-bootstrap";
import { blueskyProvider } from "@/lib/social/providers/bluesky";
import { encryptToken } from "@/lib/social/crypto";
import { SocialAccountQuotaExceededError, upsertSocialAccount } from "@/lib/social/repository";
import { getWorkspaceChannelEntitlement } from "@/lib/commercial/channel-entitlement";
import { countActiveSocialAccounts } from "@/lib/social/repository";
import { quotaExceededPayload } from "@/lib/social/limits";
import { logger } from "@/utils/logger";

interface ConnectBlueskyRequest {
  handle: string;
  appPassword: string;
}

interface ConnectBlueskyResponse {
  success: boolean;
  account?: {
    id: string;
    platform: string;
    displayName: string;
    username: string | null;
  };
  error?: string;
  code?: string;
  billingUrl?: string;
}

export async function POST(
  request: NextRequest,
): Promise<NextResponse<ConnectBlueskyResponse>> {
  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      { success: false, error: "DATABASE_URL is not configured." },
      { status: 503 },
    );
  }

  try {
    const result = await withApiPermission(request, {
      route: "/api/social/accounts/connect-bluesky",
      permission: "social:connect",
    });

    if (!result.authorized) {
      return result.response;
    }

    const body = (await request.json()) as ConnectBlueskyRequest;

    if (!body.handle?.trim() || !body.appPassword?.trim()) {
      return NextResponse.json(
        { success: false, error: "Handle and app password are required." },
        { status: 400 },
      );
    }

    const entitlement = await getWorkspaceChannelEntitlement(result.session.workspace.id);
    const activeChannels = await countActiveSocialAccounts(
      result.session.workspace.id,
    );
    if (activeChannels >= entitlement.connectedChannels) {
      return NextResponse.json(
        quotaExceededPayload({
          section: "channels",
          current: activeChannels,
          limit: entitlement.connectedChannels,
        }),
        { status: 402 },
      );
    }

    const handle = body.handle.replace(/^@/, "").trim();

    const authResult = await blueskyProvider.authenticate({
      code: body.appPassword.trim(),
      state: handle,
      redirectUri: "",
    });

    const account = await upsertSocialAccount({
      workspaceId: result.session.workspace.id,
      platform: "bluesky",
      platformUserId: authResult.platformUserId,
      displayName: authResult.displayName,
      username: authResult.username,
      avatarUrl: authResult.avatarUrl,
      accessTokenEncrypted: encryptToken(authResult.accessToken),
      refreshTokenEncrypted: authResult.refreshToken
        ? encryptToken(authResult.refreshToken)
        : undefined,
      tokenExpiresAt: authResult.expiresIn
        ? new Date(Date.now() + authResult.expiresIn * 1000)
        : undefined,
      createdByUserId: result.session.user.id,
      maxActiveChannels: entitlement.connectedChannels,
    });

    logger.info("system", "Bluesky channel connected via app password", {
      workspaceId: result.session.workspace.id,
      provider: "bluesky",
      postId: null,
      accountId: account.id,
      dispatchKey: null,
      workflowRunRef: null,
    });

    return NextResponse.json({
      success: true,
      account: {
        id: account.id,
        platform: "bluesky",
        displayName: authResult.displayName,
        username: authResult.username ?? null,
      },
    });
  } catch (error) {
    if (error instanceof SocialAccountQuotaExceededError) {
      return NextResponse.json(
        quotaExceededPayload({ section: "channels", current: error.current, limit: error.limit }),
        { status: 402 },
      );
    }
    const message =
      error instanceof Error ? error.message : "Failed to connect Bluesky account";
    return NextResponse.json(
      { success: false, error: message },
      { status: 400 },
    );
  }
}
