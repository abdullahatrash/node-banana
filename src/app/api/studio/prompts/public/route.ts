import { NextRequest, NextResponse } from "next/server";
import { listPublicPrompts } from "@/lib/studio/repository";
import { withStudioAuth } from "@/lib/studio/withStudioAuth";

interface PublicPromptsGetResponse {
  success: boolean;
  prompts?: Awaited<ReturnType<typeof listPublicPrompts>>;
  error?: string;
}

const VALID_MODES = new Set(["photo", "video", "copy"]);

// Public prompts require authentication but not workspace write access
export const GET = withStudioAuth<undefined>(
  { route: "/api/studio/prompts/public", action: "read" },
  async (request: NextRequest): Promise<NextResponse<PublicPromptsGetResponse>> => {
    const mode = request.nextUrl.searchParams.get("mode") || undefined;
    if (mode && !VALID_MODES.has(mode)) {
      return NextResponse.json(
        { success: false, error: "Invalid mode. Must be photo, video, or copy." },
        { status: 400 },
      );
    }

    const prompts = await listPublicPrompts(mode);
    return NextResponse.json({ success: true, prompts });
  },
);
