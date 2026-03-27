import { NextRequest, NextResponse } from "next/server";
import { isDatabaseConfigured } from "@/lib/db";
import { withApiPermission } from "@/lib/studio/authz";
import {
  markSocialEventRead,
  markSocialEventReadForUser,
  SocialEventNotFoundError,
} from "@/lib/social/repository";

interface ReadEventResponse {
  success: boolean;
  event?: Record<string, unknown>;
  error?: string;
}

function parseBoolean(value: string | null): boolean {
  return value === "true";
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ eventId: string }> },
): Promise<NextResponse<ReadEventResponse>> {
  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      { success: false, error: "DATABASE_URL is not configured." },
      { status: 503 },
    );
  }

  try {
    const result = await withApiPermission(request, {
      route: "/api/social/events",
      permission: "social:view",
    });

    if (!result.authorized) {
      return result.response;
    }

    const { eventId } = await params;
    const url = new URL(request.url);
    const perUserReads = parseBoolean(url.searchParams.get("perUserReads"));
    const event = perUserReads
      ? await markSocialEventReadForUser({
          workspaceId: result.session.workspace.id,
          eventId,
          userId: result.session.user.id,
        })
      : await markSocialEventRead(result.session.workspace.id, eventId);

    return NextResponse.json({ success: true, event });
  } catch (error) {
    if (error instanceof SocialEventNotFoundError) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 404 },
      );
    }

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to update social event",
      },
      { status: 500 },
    );
  }
}
