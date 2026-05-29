import { NextRequest, NextResponse } from "next/server";
import type { UIMessage } from "ai";
import { withApiPermission } from "@/lib/studio/authz";
import { resolveCopilotModel } from "@/lib/social/copilot/byok";
import { streamCopilotResponse } from "@/lib/social/copilot/agent";

export const maxDuration = 60;

interface CopilotRequestBody {
  messages?: UIMessage[];
  model?: string;
}

export async function POST(request: NextRequest): Promise<Response> {
  const auth = await withApiPermission(request, {
    route: "/api/social/copilot",
    permission: "social:view",
  });
  if (!auth.authorized) {
    return auth.response;
  }

  const body = (await request.json()) as CopilotRequestBody;

  const resolved = resolveCopilotModel(request.headers, body.model);
  if (!resolved.ok) {
    return NextResponse.json(
      { success: false, error: resolved.error },
      { status: 400 },
    );
  }

  return streamCopilotResponse({
    provider: resolved.provider,
    modelId: resolved.modelId,
    apiKey: resolved.apiKey,
    ctx: {
      workspaceId: auth.session.workspace.id,
      userId: auth.session.user.id,
    },
    messages: body.messages ?? [],
  });
}
