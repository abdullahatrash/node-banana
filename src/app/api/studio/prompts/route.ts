import { NextRequest, NextResponse } from "next/server";
import { createPrompt, listPrompts } from "@/lib/studio/repository";
import { withStudioAuth } from "@/lib/studio/withStudioAuth";

interface PromptsGetResponse {
  success: boolean;
  prompts?: Awaited<ReturnType<typeof listPrompts>>;
  error?: string;
}

interface PromptsPostRequest {
  mode: "photo" | "video" | "copy";
  name: string;
  promptText: string;
  formConfig?: Record<string, unknown>;
  isPublic?: boolean;
}

interface PromptsPostResponse {
  success: boolean;
  prompt?: Awaited<ReturnType<typeof createPrompt>>;
  error?: string;
}

const VALID_MODES = new Set(["photo", "video", "copy"]);

export const GET = withStudioAuth<undefined>(
  { route: "/api/studio/prompts", action: "read", permission: "projects:read" },
  async (request: NextRequest, authz): Promise<NextResponse<PromptsGetResponse>> => {
    const mode = request.nextUrl.searchParams.get("mode") || undefined;
    if (mode && !VALID_MODES.has(mode)) {
      return NextResponse.json(
        { success: false, error: "Invalid mode. Must be photo, video, or copy." },
        { status: 400 },
      );
    }

    const prompts = await listPrompts(authz.workspaceId, mode);
    return NextResponse.json({ success: true, prompts });
  },
);

export const POST = withStudioAuth<undefined>(
  { route: "/api/studio/prompts", action: "write", permission: "projects:write" },
  async (request: NextRequest, authz): Promise<NextResponse<PromptsPostResponse>> => {
    const body = (await request.json()) as PromptsPostRequest;

    if (!body.name?.trim()) {
      return NextResponse.json(
        { success: false, error: "Prompt name is required." },
        { status: 400 },
      );
    }
    if (!body.promptText?.trim()) {
      return NextResponse.json(
        { success: false, error: "Prompt text is required." },
        { status: 400 },
      );
    }
    if (!body.mode || !VALID_MODES.has(body.mode)) {
      return NextResponse.json(
        { success: false, error: "Invalid mode. Must be photo, video, or copy." },
        { status: 400 },
      );
    }

    const prompt = await createPrompt({
      workspaceId: authz.workspaceId,
      mode: body.mode,
      name: body.name.trim(),
      promptText: body.promptText.trim(),
      formConfig: body.formConfig || {},
      isPublic: body.isPublic ?? false,
    });

    return NextResponse.json({ success: true, prompt });
  },
);
