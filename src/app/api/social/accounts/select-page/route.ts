import { NextRequest, NextResponse } from "next/server";
import { isDatabaseConfigured } from "@/lib/db";
import { withApiPermission } from "@/lib/studio/authz";
import { getProvider } from "@/lib/social/provider-registry";
import { encryptToken } from "@/lib/social/crypto";
import { upsertSocialAccount } from "@/lib/social/repository";
import type { SocialPlatform } from "@/lib/db/schema";

interface SelectPageRequest {
  platform: string;
  pageId: string;
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
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

    if (!body.platform?.trim() || !body.pageId?.trim() || !body.accessToken?.trim()) {
      return NextResponse.json(
        { success: false, error: "Platform, pageId, and accessToken are required." },
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

    // Fetch page-specific details (may include page-level access token)
    const pages = await provider.fetchPageInformation(body.accessToken);
    const selectedPage = pages.find((p) => p.id === body.pageId);

    if (!selectedPage) {
      return NextResponse.json(
        { success: false, error: "Selected page not found." },
        { status: 404 },
      );
    }

    // Use page-specific token if available, otherwise use the original token
    const finalAccessToken = selectedPage.accessToken || body.accessToken;

    const account = await upsertSocialAccount({
      workspaceId: result.session.workspace.id,
      platform: body.platform as SocialPlatform,
      platformUserId: selectedPage.id,
      displayName: selectedPage.name,
      username: selectedPage.username,
      avatarUrl: selectedPage.picture,
      accessTokenEncrypted: encryptToken(finalAccessToken),
      refreshTokenEncrypted: body.refreshToken
        ? encryptToken(body.refreshToken)
        : undefined,
      tokenExpiresAt: body.expiresIn
        ? new Date(Date.now() + body.expiresIn * 1000)
        : undefined,
      createdByUserId: result.session.user.id,
    });

    const { accessTokenEncrypted, refreshTokenEncrypted, accessTokenSecret, ...safeAccount } = account;

    return NextResponse.json({ success: true, account: safeAccount });
  } catch (error) {
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
