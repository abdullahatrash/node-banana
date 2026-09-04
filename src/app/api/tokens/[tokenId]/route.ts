import { NextRequest, NextResponse } from "next/server";

import { revokeApiToken } from "@/lib/api-tokens/repository";
import { withStudioAuth } from "@/lib/studio/withStudioAuth";

const ROUTE = "/api/tokens/[tokenId]";

interface RevokeResponse {
  success: boolean;
  error?: string;
}

type TokenIdContext = { params: Promise<{ tokenId: string }> };

/** Revoke a token. Scoped to the caller's workspace; takes effect immediately. */
export const DELETE = withStudioAuth<TokenIdContext>(
  { route: ROUTE, action: "delete", permission: "workspaces:delete" },
  async (
    _request: NextRequest,
    authz,
    context,
  ): Promise<NextResponse<RevokeResponse>> => {
    const { tokenId } = await context.params;

    const revoked = await revokeApiToken({
      workspaceId: authz.workspaceId,
      tokenId,
    });

    if (!revoked) {
      return NextResponse.json(
        { success: false, error: "Token not found." },
        { status: 404 },
      );
    }

    return NextResponse.json({ success: true });
  },
);
