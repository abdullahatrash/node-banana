import { NextRequest, NextResponse } from "next/server";

import { listSocialAccountsTool } from "@/lib/agent-tools/tools/list-social-accounts";
import { toolErrorResponse } from "@/lib/agent-tools/http";
import { runTool } from "@/lib/agent-tools/runtime";
import { authorizePublicApiRequest } from "@/lib/api-tokens/auth";
import { isDatabaseConfigured } from "@/lib/db";

const ROUTE = "/api/v1/social-accounts";

/**
 * Public API v1: list the workspace's connected social accounts.
 *
 * A thin wrapper over the `list_social_accounts` registry tool — the same
 * handler the MCP server and CLI use — so REST parity is guaranteed by
 * construction. No business logic lives here.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      {
        success: false,
        error:
          "DATABASE_URL is not configured. Configure Postgres to use the API.",
      },
      { status: 503 },
    );
  }

  const auth = await authorizePublicApiRequest(request, {
    route: ROUTE,
    permission: listSocialAccountsTool.requiredPermission,
  });

  if (!auth.authorized) {
    return auth.response;
  }

  try {
    const output = await runTool(
      listSocialAccountsTool,
      {},
      { session: auth.session },
    );
    return NextResponse.json({ success: true, ...output });
  } catch (error) {
    return toolErrorResponse(error);
  }
}
