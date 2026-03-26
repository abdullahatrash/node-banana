import { NextRequest, NextResponse } from "next/server";
import { isDatabaseConfigured } from "@/lib/db";
import { withApiPermission } from "@/lib/studio/authz";
import {
  disconnectSocialAccount,
  getSocialAccount,
  SocialAccountNotFoundError,
} from "@/lib/social/repository";

interface AccountResponse {
  success: boolean;
  account?: Record<string, unknown>;
  error?: string;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ accountId: string }> },
): Promise<NextResponse<AccountResponse>> {
  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      { success: false, error: "DATABASE_URL is not configured." },
      { status: 503 },
    );
  }

  try {
    const result = await withApiPermission(request, {
      route: "/api/social/accounts",
      permission: "social:view",
    });

    if (!result.authorized) {
      return result.response;
    }

    const { accountId } = await params;
    const account = await getSocialAccount(
      result.session.workspace.id,
      accountId,
    );

    // Strip encrypted tokens
    const { accessTokenEncrypted, refreshTokenEncrypted, accessTokenSecret, ...safeAccount } = account;

    return NextResponse.json({ success: true, account: safeAccount });
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
            : "Failed to get account",
      },
      { status: 500 },
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ accountId: string }> },
): Promise<NextResponse<{ success: boolean; error?: string }>> {
  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      { success: false, error: "DATABASE_URL is not configured." },
      { status: 503 },
    );
  }

  try {
    const result = await withApiPermission(request, {
      route: "/api/social/accounts",
      permission: "social:manage",
    });

    if (!result.authorized) {
      return result.response;
    }

    const { accountId } = await params;
    await disconnectSocialAccount(result.session.workspace.id, accountId);

    return NextResponse.json({ success: true });
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
            : "Failed to disconnect account",
      },
      { status: 500 },
    );
  }
}
