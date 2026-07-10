import { NextRequest, NextResponse } from "next/server";

import { listAssetsTool } from "@/lib/agent-tools/tools/list-assets";
import { uploadAssetTool } from "@/lib/agent-tools/tools/upload-asset";
import { ToolError } from "@/lib/agent-tools/errors";
import { toolErrorResponse } from "@/lib/agent-tools/http";
import { runTool } from "@/lib/agent-tools/runtime";
import { authorizePublicApiRequest } from "@/lib/api-tokens/auth";
import { isDatabaseConfigured } from "@/lib/db";

const ROUTE = "/api/v1/assets";

/**
 * Public API v1: list the workspace's media assets.
 *
 * A thin wrapper over the `list_assets` registry tool. Query params `type` and
 * `limit` are forwarded to the tool, whose Zod schema validates them (an
 * invalid value yields a structured 400) — the route holds no business logic.
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
    permission: listAssetsTool.requiredPermission,
  });

  if (!auth.authorized) {
    return auth.response;
  }

  const params = request.nextUrl.searchParams;
  const rawType = params.get("type");
  const rawLimit = params.get("limit");

  const input = {
    type: rawType ?? undefined,
    limit: rawLimit === null ? undefined : Number(rawLimit),
  };

  try {
    const output = await runTool(listAssetsTool, input, {
      session: auth.session,
    });
    return NextResponse.json({ success: true, ...output });
  } catch (error) {
    return toolErrorResponse(error);
  }
}

/**
 * Public API v1: upload media into the workspace, from base64 content or a
 * source URL.
 *
 * A thin wrapper over the `upload_asset` registry tool, which enforces the
 * exact same type and workspace storage-quota rules as the Studio upload UI.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
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
    permission: uploadAssetTool.requiredPermission,
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
        fix: "Send a JSON body with assetType and either base64Content or sourceUrl.",
      }),
    );
  }

  try {
    const output = await runTool(uploadAssetTool, body, {
      session: auth.session,
    });
    return NextResponse.json({ success: true, ...output }, { status: 201 });
  } catch (error) {
    return toolErrorResponse(error);
  }
}
