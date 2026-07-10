import { NextRequest, NextResponse } from "next/server";

import { getAssetDownloadUrlTool } from "@/lib/agent-tools/tools/get-asset-download-url";
import { toolErrorResponse } from "@/lib/agent-tools/http";
import { runTool } from "@/lib/agent-tools/runtime";
import { authorizePublicApiRequest } from "@/lib/api-tokens/auth";
import { isDatabaseConfigured } from "@/lib/db";

const ROUTE = "/api/v1/assets/[assetId]/download-url";

type AssetIdContext = { params: Promise<{ assetId: string }> };

/**
 * Public API v1: get a download URL (CDN or presigned) for an asset already in
 * this workspace.
 *
 * A thin wrapper over the `get_asset_download_url` registry tool — the same
 * handler the MCP server and CLI use — so no business logic lives here.
 */
export async function GET(
  request: NextRequest,
  context: AssetIdContext,
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
    permission: getAssetDownloadUrlTool.requiredPermission,
  });

  if (!auth.authorized) {
    return auth.response;
  }

  const { assetId } = await context.params;

  try {
    const output = await runTool(
      getAssetDownloadUrlTool,
      { assetId },
      { session: auth.session },
    );
    return NextResponse.json({ success: true, ...output });
  } catch (error) {
    return toolErrorResponse(error);
  }
}
