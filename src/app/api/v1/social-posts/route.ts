import { NextRequest, NextResponse } from "next/server";

import { createSocialPostTool } from "@/lib/agent-tools/tools/create-social-post";
import { listSocialPostsTool } from "@/lib/agent-tools/tools/list-social-posts";
import { ToolError } from "@/lib/agent-tools/errors";
import { toolErrorResponse } from "@/lib/agent-tools/http";
import { runTool } from "@/lib/agent-tools/runtime";
import { authorizePublicApiRequest } from "@/lib/api-tokens/auth";
import { isDatabaseConfigured } from "@/lib/db";

const ROUTE = "/api/v1/social-posts";

function databaseUnavailable(): NextResponse {
  return NextResponse.json(
    {
      success: false,
      error:
        "DATABASE_URL is not configured. Configure Postgres to use the API.",
    },
    { status: 503 },
  );
}

/**
 * Public API v1: list the workspace's social posts as summaries with dispatch
 * status and failure reason.
 *
 * A thin wrapper over the `list_social_posts` registry tool — the same handler
 * the MCP server and CLI use. Query params (status, platform, socialAccountId,
 * startDate, endDate, limit) are forwarded to the tool, whose Zod schema
 * validates them; no business logic lives here.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!isDatabaseConfigured()) {
    return databaseUnavailable();
  }

  const auth = await authorizePublicApiRequest(request, {
    route: ROUTE,
    permission: listSocialPostsTool.requiredPermission,
  });

  if (!auth.authorized) {
    return auth.response;
  }

  const params = request.nextUrl.searchParams;
  const rawLimit = params.get("limit");
  const input = {
    status: params.get("status") ?? undefined,
    platform: params.get("platform") ?? undefined,
    socialAccountId: params.get("socialAccountId") ?? undefined,
    startDate: params.get("startDate") ?? undefined,
    endDate: params.get("endDate") ?? undefined,
    limit: rawLimit === null ? undefined : Number(rawLimit),
  };

  try {
    const output = await runTool(listSocialPostsTool, input, {
      session: auth.session,
    });
    return NextResponse.json({ success: true, ...output });
  } catch (error) {
    return toolErrorResponse(error);
  }
}

/**
 * Public API v1: create a social post (draft, scheduled, or published now).
 *
 * A thin wrapper over the `create_social_post` registry tool, which enforces
 * the same account-ownership, quota, and platform-constraint rules as the app
 * composer and queues posts into the identical dispatch pipeline.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!isDatabaseConfigured()) {
    return databaseUnavailable();
  }

  const auth = await authorizePublicApiRequest(request, {
    route: ROUTE,
    permission: createSocialPostTool.requiredPermission,
  });

  if (!auth.authorized) {
    return auth.response;
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return toolErrorResponse(
      new ToolError({
        code: "invalid_input",
        message: "Request body must be valid JSON.",
        fix: "Send a JSON body with at least socialAccountId and content or mediaAssetIds.",
      }),
    );
  }

  try {
    const output = await runTool(createSocialPostTool, body, {
      session: auth.session,
    });
    return NextResponse.json({ success: true, ...output }, { status: 201 });
  } catch (error) {
    return toolErrorResponse(error);
  }
}
