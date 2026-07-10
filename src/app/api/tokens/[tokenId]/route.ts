import { NextRequest, NextResponse } from "next/server";

import { revokeApiToken } from "@/lib/api-tokens/repository";
import { isDatabaseConfigured } from "@/lib/db";
import { withApiPermission } from "@/lib/studio/authz";

const ROUTE = "/api/tokens/[tokenId]";

interface RevokeResponse {
  success: boolean;
  error?: string;
}

/** Revoke a token. Scoped to the caller's workspace; takes effect immediately. */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ tokenId: string }> },
): Promise<NextResponse<RevokeResponse>> {
  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      {
        success: false,
        error:
          "DATABASE_URL is not configured. Configure Postgres to use API tokens.",
      },
      { status: 503 },
    );
  }

  const auth = await withApiPermission(request, {
    route: ROUTE,
    permission: "workspaces:write",
  });
  if (!auth.authorized) {
    return auth.response;
  }

  const { tokenId } = await params;

  try {
    const revoked = await revokeApiToken({
      workspaceId: auth.session.workspace.id,
      tokenId,
    });

    if (!revoked) {
      return NextResponse.json(
        { success: false, error: "Token not found." },
        { status: 404 },
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error ? error.message : "Failed to revoke API token",
      },
      { status: 500 },
    );
  }
}
