import { NextRequest, NextResponse } from "next/server";
import { isDatabaseConfigured } from "@/lib/db";
import { withApiPermission, authzErrorResponse } from "@/lib/studio/authz";
import { listSocialAccounts } from "@/lib/social/repository";

interface AccountsResponse {
  success: boolean;
  accounts?: Awaited<ReturnType<typeof listSocialAccounts>>;
  error?: string;
}

export async function GET(
  request: NextRequest,
): Promise<NextResponse<AccountsResponse>> {
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

    const accounts = await listSocialAccounts(result.session.workspace.id);

    // Strip encrypted tokens from response
    const safeAccounts = accounts.map(
      ({ accessTokenEncrypted, refreshTokenEncrypted, accessTokenSecret, ...rest }) => rest,
    );

    return NextResponse.json({ success: true, accounts: safeAccounts as typeof accounts });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to list social accounts",
      },
      { status: 500 },
    );
  }
}
