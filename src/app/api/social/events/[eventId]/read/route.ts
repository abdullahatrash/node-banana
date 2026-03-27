import { NextRequest, NextResponse } from "next/server";
import { isDatabaseConfigured } from "@/lib/db";
import { withApiPermission } from "@/lib/studio/authz";
import { markSocialEventRead, SocialEventNotFoundError } from "@/lib/social/repository";

interface ReadEventResponse {
  success: boolean;
  event?: Awaited<ReturnType<typeof markSocialEventRead>>;
  error?: string;
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
    const event = await markSocialEventRead(result.session.workspace.id, eventId);

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
