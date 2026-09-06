import { NextRequest, NextResponse } from "next/server";

import { toolErrorResponse } from "@/lib/agent-tools/http";
import { runTool } from "@/lib/agent-tools/runtime";
import { runWorkflowTool } from "@/lib/agent-tools/tools/run-workflow";
import { authorizePublicApiRequest } from "@/lib/api-tokens/auth";
import { isDatabaseConfigured } from "@/lib/db";

export const maxDuration = 300; // Background run kicks off inside the request.

const ROUTE = "/api/v1/runs";

/**
 * Public API v1: start a workflow run.
 *
 * A thin wrapper over the `run_workflow` registry tool. The registered tool is
 * deliberately fail-closed until workflow nodes have admitted AI adapters.
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
    permission: runWorkflowTool.requiredPermission,
  });
  if (!auth.authorized) {
    return auth.response;
  }

  let body: Record<string, unknown> = {};
  try {
    const parsed = await request.json();
    if (parsed && typeof parsed === "object") {
      body = parsed as Record<string, unknown>;
    }
  } catch {
    // Empty/invalid body — the tool's schema will reject a missing projectId.
  }

  const input = {
    projectId: body.projectId,
    inputOverrides: body.inputOverrides,
  };

  try {
    const output = await runTool(runWorkflowTool, input, {
      session: auth.session,
    });
    return NextResponse.json({ success: true, ...output }, { status: 202 });
  } catch (error) {
    return toolErrorResponse(error);
  }
}
