import { NextRequest, NextResponse } from "next/server";
import { isDatabaseConfigured } from "@/lib/db";
import { authorizeStudioRequest, authzErrorResponse } from "@/lib/studio/authz";
import { createPrompt, listPrompts } from "@/lib/studio/repository";

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

export async function GET(
  request: NextRequest,
): Promise<NextResponse<PromptsGetResponse>> {
  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      { success: false, error: "DATABASE_URL is not configured." },
      { status: 503 },
    );
  }

  try {
    const authz = await authorizeStudioRequest(request, {
      route: "/api/studio/prompts",
      action: "read",
    });
    if (!authz.authorized) {
      return authzErrorResponse(authz);
    }

    const mode = request.nextUrl.searchParams.get("mode") || undefined;
    if (mode && !VALID_MODES.has(mode)) {
      return NextResponse.json(
        { success: false, error: "Invalid mode. Must be photo, video, or copy." },
        { status: 400 },
      );
    }

    const prompts = await listPrompts(authz.workspaceId, mode);
    return NextResponse.json({ success: true, prompts });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to list prompts",
      },
      { status: 500 },
    );
  }
}

export async function POST(
  request: NextRequest,
): Promise<NextResponse<PromptsPostResponse>> {
  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      { success: false, error: "DATABASE_URL is not configured." },
      { status: 503 },
    );
  }

  try {
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

    const authz = await authorizeStudioRequest(request, {
      route: "/api/studio/prompts",
      action: "write",
    });
    if (!authz.authorized) {
      return authzErrorResponse(authz);
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
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to create prompt",
      },
      { status: 500 },
    );
  }
}
