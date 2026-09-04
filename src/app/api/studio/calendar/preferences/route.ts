import { NextRequest } from "next/server";
import { noStoreJson } from "@/lib/agent-auth/http-request";
import { getWorkspaceCalendarPreferences, updateWorkspaceCalendarPreferences } from "@/lib/product-surfaces/calendar-preferences";
import { withStudioAuth } from "@/lib/studio/withStudioAuth";

export const GET = withStudioAuth<undefined>(
  { route: "/api/studio/calendar/preferences", action: "read", permission: "social:view" },
  async (_request, authz) => noStoreJson({ success: true, preferences: await getWorkspaceCalendarPreferences(authz.workspaceId) }),
);

export const PATCH = withStudioAuth<undefined>(
  { route: "/api/studio/calendar/preferences", action: "write", permission: "social:publish" },
  async (request: NextRequest, authz) => {
    let body: unknown;
    try { body = await request.json(); } catch { return noStoreJson({ success: false, code: "INVALID_INPUT" }, { status: 400 }); }
    if (!body || typeof body !== "object" || Array.isArray(body)) return noStoreJson({ success: false, code: "INVALID_INPUT" }, { status: 400 });
    try {
      const value = body as Record<string, unknown>;
      const preferences = await updateWorkspaceCalendarPreferences({ workspaceId: authz.workspaceId, contentMarket: value.contentMarket, timezone: value.timezone, weekStartsOn: value.weekStartsOn });
      return noStoreJson({ success: true, preferences });
    } catch (error) {
      const code = error instanceof Error ? error.message : "CALENDAR_PREFERENCES_UNAVAILABLE";
      return noStoreJson({ success: false, code }, { status: code.endsWith("INVALID") ? 400 : 503 });
    }
  },
);
