import { NextRequest, NextResponse } from "next/server";
import { isDatabaseConfigured } from "@/lib/db";
import { withApiPermission } from "@/lib/studio/authz";
import { listSocialEventReadsForUser, listSocialEvents } from "@/lib/social/repository";

interface EventsGetResponse {
  success: boolean;
  events?: Awaited<ReturnType<typeof listSocialEvents>>;
  error?: string;
}

function parseBoolean(value: string | null): boolean | undefined {
  if (value === null) return undefined;
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}

export async function GET(
  request: NextRequest,
): Promise<NextResponse<EventsGetResponse>> {
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

    const url = new URL(request.url);
    const userFacing = parseBoolean(url.searchParams.get("userFacing"));
    const unreadOnly = parseBoolean(url.searchParams.get("unreadOnly"));
    const perUserReads = parseBoolean(url.searchParams.get("perUserReads")) ?? false;
    const limit = url.searchParams.get("limit");
    const offset = url.searchParams.get("offset");

    const events = await listSocialEvents(result.session.workspace.id, {
      userFacing,
      unreadOnly: perUserReads ? false : unreadOnly ?? false,
      limit: limit ? Number.parseInt(limit, 10) : undefined,
      offset: offset ? Number.parseInt(offset, 10) : undefined,
    });

    if (!perUserReads) {
      return NextResponse.json({ success: true, events });
    }

    const eventReads = await listSocialEventReadsForUser(
      result.session.workspace.id,
      result.session.user.id,
    );
    const readEventIds = new Set(eventReads.map((row) => row.eventId));

    const enrichedEvents = events.map((event) => ({
      ...event,
      readByCurrentUser: readEventIds.has(event.id),
    }));

    const finalEvents = unreadOnly
      ? enrichedEvents.filter((event) => !event.readByCurrentUser)
      : enrichedEvents;

    return NextResponse.json({ success: true, events: finalEvents });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to list social events",
      },
      { status: 500 },
    );
  }
}
