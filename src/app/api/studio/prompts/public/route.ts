import { NextRequest, NextResponse } from "next/server";
import { isDatabaseConfigured } from "@/lib/db";
import { authorizeStudioRequest, authzErrorResponse } from "@/lib/studio/authz";
import { listPublicPrompts } from "@/lib/studio/repository";

interface PublicPromptsGetResponse {
  success: boolean;
  prompts?: Awaited<ReturnType<typeof listPublicPrompts>>;
  error?: string;
}

const VALID_MODES = new Set(["photo", "video", "copy"]);

export async function GET(
  request: NextRequest,
): Promise<NextResponse<PublicPromptsGetResponse>> {
  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      { success: false, error: "DATABASE_URL is not configured." },
      { status: 503 },
    );
  }

  try {
    // Public prompts require authentication but not workspace write access
    const authz = await authorizeStudioRequest(request, {
      route: "/api/studio/prompts/public",
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

    const prompts = await listPublicPrompts(mode);
    return NextResponse.json({ success: true, prompts });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to list public prompts",
      },
      { status: 500 },
    );
  }
}
