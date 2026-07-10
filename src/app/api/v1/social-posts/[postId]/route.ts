import { NextRequest, NextResponse } from "next/server";

import { getSocialPostStatusTool } from "@/lib/agent-tools/tools/get-social-post-status";
import { toolErrorResponse } from "@/lib/agent-tools/http";
import { runTool } from "@/lib/agent-tools/runtime";
import { authorizePublicApiRequest } from "@/lib/api-tokens/auth";
import { isDatabaseConfigured } from "@/lib/db";

const ROUTE = "/api/v1/social-posts/[postId]";

type PostIdContext = { params: Promise<{ postId: string }> };

/**
 * Public API v1: get a single social post's full dispatch state.
 *
 * A thin wrapper over the `get_social_post_status` registry tool — the same
 * handler the MCP server and CLI use — so no business logic lives here.
 */
export async function GET(
  request: NextRequest,
  context: PostIdContext,
): Promise<NextResponse> {
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
    permission: getSocialPostStatusTool.requiredPermission,
  });

  if (!auth.authorized) {
    return auth.response;
  }

  const { postId } = await context.params;

  try {
    const output = await runTool(
      getSocialPostStatusTool,
      { postId },
      { session: auth.session },
    );
    return NextResponse.json({ success: true, ...output });
  } catch (error) {
    return toolErrorResponse(error);
  }
}
