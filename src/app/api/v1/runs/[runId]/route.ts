import { NextRequest, NextResponse } from "next/server";

import { toolErrorResponse } from "@/lib/agent-tools/http";
import { runTool } from "@/lib/agent-tools/runtime";
import { getRunStatusTool } from "@/lib/agent-tools/tools/get-run-status";
import { authorizePublicApiRequest } from "@/lib/api-tokens/auth";
import { isDatabaseConfigured } from "@/lib/db";

const ROUTE = "/api/v1/runs/[runId]";

/**
 * Public API v1: read a workflow run's status.
 *
 * A thin wrapper over the `get_run_status` registry tool — reports overall
 * status, per-node progress, output asset refs, and any error. Poll until the
 * status is terminal (succeeded / failed / cancelled).
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ runId: string }> },
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
    permission: getRunStatusTool.requiredPermission,
  });
  if (!auth.authorized) {
    return auth.response;
  }

  const { runId } = await context.params;

  try {
    const output = await runTool(
      getRunStatusTool,
      { runId },
      { session: auth.session },
    );
    return NextResponse.json({ success: true, ...output });
  } catch (error) {
    return toolErrorResponse(error);
  }
}
