import { NextRequest, NextResponse } from "next/server";
import { isDatabaseConfigured } from "@/lib/db";
import { authorizeStudioRequest, authzErrorResponse } from "@/lib/studio/authz";
import { getPrompt, updatePrompt, softDeletePrompt } from "@/lib/studio/repository";

interface PromptResponse {
  success: boolean;
  prompt?: Awaited<ReturnType<typeof getPrompt>>;
  error?: string;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ promptId: string }> },
): Promise<NextResponse<PromptResponse>> {
  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      { success: false, error: "DATABASE_URL is not configured." },
      { status: 503 },
    );
  }

  try {
    const { promptId } = await params;
    const body = await request.json();

    const authz = await authorizeStudioRequest(request, {
      route: "/api/studio/prompts",
      action: "write",
    });
    if (!authz.authorized) {
      return authzErrorResponse(authz);
    }

    // Verify prompt exists and belongs to workspace
    const existing = await getPrompt(authz.workspaceId, promptId);
    if (!existing) {
      return NextResponse.json(
        { success: false, error: "Prompt not found." },
        { status: 404 },
      );
    }

    const prompt = await updatePrompt(authz.workspaceId, promptId, {
      name: body.name,
      promptText: body.promptText,
      formConfig: body.formConfig,
      isPublic: body.isPublic,
    });

    return NextResponse.json({ success: true, prompt });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to update prompt",
      },
      { status: 500 },
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ promptId: string }> },
): Promise<NextResponse<PromptResponse>> {
  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      { success: false, error: "DATABASE_URL is not configured." },
      { status: 503 },
    );
  }

  try {
    const { promptId } = await params;

    const authz = await authorizeStudioRequest(request, {
      route: "/api/studio/prompts",
      action: "write",
    });
    if (!authz.authorized) {
      return authzErrorResponse(authz);
    }

    const prompt = await softDeletePrompt(authz.workspaceId, promptId);
    if (!prompt) {
      return NextResponse.json(
        { success: false, error: "Prompt not found." },
        { status: 404 },
      );
    }

    return NextResponse.json({ success: true, prompt });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to delete prompt",
      },
      { status: 500 },
    );
  }
}
