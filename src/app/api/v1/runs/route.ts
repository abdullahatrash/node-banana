import { NextRequest, NextResponse } from "next/server";

import { toolErrorResponse } from "@/lib/agent-tools/http";
import { runTool } from "@/lib/agent-tools/runtime";
import { runWorkflowTool } from "@/lib/agent-tools/tools/run-workflow";
import { authorizePublicApiRequest } from "@/lib/api-tokens/auth";
import { isDatabaseConfigured } from "@/lib/db";

export const maxDuration = 300; // Background run kicks off inside the request.

const ROUTE = "/api/v1/runs";

/** Collect BYOK provider keys from request headers (header pass-through). */
function providerKeysFromHeaders(
  request: NextRequest,
): Record<string, string> {
  const keys: Record<string, string> = {};
  const gemini =
    request.headers.get("X-Gemini-API-Key") ||
    request.headers.get("X-Google-API-Key");
  const openai = request.headers.get("X-OpenAI-API-Key");
  const anthropic = request.headers.get("X-Anthropic-API-Key");
  if (gemini) keys.gemini = gemini;
  if (openai) keys.openai = openai;
  if (anthropic) keys.anthropic = anthropic;
  return keys;
}

/**
 * Public API v1: start a workflow run.
 *
 * A thin wrapper over the `run_workflow` registry tool. BYOK keys may arrive as
 * `X-*-API-Key` headers and/or a `providerKeys` body field (body wins on
 * conflict); everything else (validation, structured errors, async job
 * creation) lives in the tool, so the route holds no business logic.
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

  const headerKeys = providerKeysFromHeaders(request);
  const bodyKeys =
    body.providerKeys && typeof body.providerKeys === "object"
      ? (body.providerKeys as Record<string, unknown>)
      : {};
  const providerKeys = { ...headerKeys, ...bodyKeys };

  const input = {
    projectId: body.projectId,
    inputOverrides: body.inputOverrides,
    ...(Object.keys(providerKeys).length > 0 ? { providerKeys } : {}),
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
