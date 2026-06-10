import { NextRequest, NextResponse } from "next/server";
import { getPrompt, updatePrompt, softDeletePrompt } from "@/lib/studio/repository";
import { withStudioAuth } from "@/lib/studio/withStudioAuth";

interface PromptResponse {
  success: boolean;
  prompt?: Awaited<ReturnType<typeof getPrompt>>;
  error?: string;
}

type PromptIdContext = { params: Promise<{ promptId: string }> };

export const PATCH = withStudioAuth<PromptIdContext>(
  { route: "/api/studio/prompts", action: "write" },
  async (
    request: NextRequest,
    authz,
    context,
  ): Promise<NextResponse<PromptResponse>> => {
    const { promptId } = await context.params;
    const body = await request.json();

    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return NextResponse.json(
        { success: false, error: "Request body must be a JSON object." },
        { status: 400 },
      );
    }

    if (body.name !== undefined) {
      if (typeof body.name !== "string" || !body.name.trim()) {
        return NextResponse.json(
          { success: false, error: "name must be a non-empty string." },
          { status: 400 },
        );
      }
    }

    if (body.promptText !== undefined) {
      if (typeof body.promptText !== "string" || !body.promptText.trim()) {
        return NextResponse.json(
          { success: false, error: "promptText must be a non-empty string." },
          { status: 400 },
        );
      }
    }

    if (body.isPublic !== undefined && typeof body.isPublic !== "boolean") {
      return NextResponse.json(
        { success: false, error: "isPublic must be a boolean." },
        { status: 400 },
      );
    }

    if (
      body.formConfig !== undefined &&
      (typeof body.formConfig !== "object" ||
        body.formConfig === null ||
        Array.isArray(body.formConfig))
    ) {
      return NextResponse.json(
        { success: false, error: "formConfig must be a plain object." },
        { status: 400 },
      );
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
      name: body.name !== undefined ? String(body.name).trim() : undefined,
      promptText:
        body.promptText !== undefined ? String(body.promptText).trim() : undefined,
      formConfig: body.formConfig,
      isPublic: body.isPublic,
    });

    return NextResponse.json({ success: true, prompt });
  },
);

export const DELETE = withStudioAuth<PromptIdContext>(
  { route: "/api/studio/prompts", action: "write" },
  async (
    _request: NextRequest,
    authz,
    context,
  ): Promise<NextResponse<PromptResponse>> => {
    const { promptId } = await context.params;

    const prompt = await softDeletePrompt(authz.workspaceId, promptId);
    if (!prompt) {
      return NextResponse.json(
        { success: false, error: "Prompt not found." },
        { status: 404 },
      );
    }

    return NextResponse.json({ success: true, prompt });
  },
);
