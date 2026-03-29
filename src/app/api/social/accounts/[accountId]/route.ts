import { NextRequest, NextResponse } from "next/server";
import { isDatabaseConfigured } from "@/lib/db";
import { withApiPermission } from "@/lib/studio/authz";
import {
  countSocialPostsForAccount,
  disconnectSocialAccount,
  getSocialAccount,
  updateSocialAccount,
  SocialAccountNotFoundError,
} from "@/lib/social/repository";

interface AccountResponse {
  success: boolean;
  account?: Record<string, unknown>;
  error?: string;
}

interface AccountPatchRequest {
  displayName?: string;
  disabled?: boolean;
  additionalSettings?: Record<string, unknown> | null;
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
    const force = new URL(request.url).searchParams.get("force") === "true";
    if (!force) {
      const linkedPosts = await countSocialPostsForAccount(
        result.session.workspace.id,
        accountId,
      );
      if (linkedPosts > 0) {
        return NextResponse.json(
          {
            success: false,
            error:
              "This channel has existing posts. Delete or move those posts first, or retry with force=true.",
          },
          { status: 409 },
        );
      }
    }
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

export async function PATCH(
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
      permission: "social:manage",
    });

    if (!result.authorized) {
      return result.response;
    }

    const { accountId } = await params;
    const body = (await request.json()) as AccountPatchRequest;

    if (
      body.displayName !== undefined &&
      (typeof body.displayName !== "string" || body.displayName.trim().length === 0)
    ) {
      return NextResponse.json(
        { success: false, error: "displayName must be a non-empty string." },
        { status: 400 },
      );
    }
    if (body.disabled !== undefined && typeof body.disabled !== "boolean") {
      return NextResponse.json(
        { success: false, error: "disabled must be a boolean." },
        { status: 400 },
      );
    }
    if (
      body.additionalSettings !== undefined &&
      body.additionalSettings !== null &&
      (typeof body.additionalSettings !== "object" ||
        Array.isArray(body.additionalSettings))
    ) {
      return NextResponse.json(
        { success: false, error: "additionalSettings must be an object." },
        { status: 400 },
      );
    }

    const account = await updateSocialAccount(
      result.session.workspace.id,
      accountId,
      {
        ...(body.displayName !== undefined
          ? { displayName: body.displayName.trim() }
          : {}),
        ...(body.disabled !== undefined ? { disabled: body.disabled } : {}),
        ...(body.additionalSettings !== undefined
          ? { additionalSettings: body.additionalSettings }
          : {}),
      },
    );

    const {
      accessTokenEncrypted,
      refreshTokenEncrypted,
      accessTokenSecret,
      ...safeAccount
    } = account;

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
            : "Failed to update account",
      },
      { status: 500 },
    );
  }
}
