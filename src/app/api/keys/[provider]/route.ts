import { NextRequest, NextResponse } from "next/server";

import { deleteProviderKey } from "@/lib/byok/repository";
import { isByokProvider } from "@/lib/byok/providers";
import { withStudioAuth } from "@/lib/studio/withStudioAuth";

const ROUTE = "/api/keys/[provider]";

interface DeleteResponse {
  success: boolean;
  error?: string;
}

type ProviderContext = { params: Promise<{ provider: string }> };

/** Delete the workspace's stored key for a provider. Takes effect immediately. */
export const DELETE = withStudioAuth<ProviderContext>(
  { route: ROUTE, action: "delete", permission: "workspaces:delete" },
  async (
    _request: NextRequest,
    authz,
    context,
  ): Promise<NextResponse<DeleteResponse>> => {
    const { provider } = await context.params;

    if (!isByokProvider(provider)) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Unknown provider. Must be one of: gemini, openai, anthropic, kie, fal, replicate, wavespeed.",
        },
        { status: 400 },
      );
    }

    const deleted = await deleteProviderKey({
      workspaceId: authz.workspaceId,
      provider,
    });

    if (!deleted) {
      return NextResponse.json(
        { success: false, error: "No stored key for this provider." },
        { status: 404 },
      );
    }

    return NextResponse.json({ success: true });
  },
);
