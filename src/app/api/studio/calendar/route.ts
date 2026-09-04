import { NextRequest } from "next/server";
import { z } from "zod";
import { noStoreJson } from "@/lib/agent-auth/http-request";
import { listCanonicalCalendar } from "@/lib/product-surfaces/calendar-projection-production";
import { withStudioAuth } from "@/lib/studio/withStudioAuth";

const query = z.object({
  start: z.string().datetime({ offset: true }),
  end: z.string().datetime({ offset: true }),
  socialAccountId: z.string().min(1).max(200).regex(/^[A-Za-z0-9_-]+$/).optional(),
}).strict();

export const GET = withStudioAuth<undefined>(
  { route: "/api/studio/calendar", action: "read", permission: "social:view" },
  async (request: NextRequest, authz) => {
    const parsed = query.safeParse(Object.fromEntries(request.nextUrl.searchParams));
    if (!parsed.success) return noStoreJson({ success: false, code: "INVALID_INPUT" }, { status: 400 });
    const start = new Date(parsed.data.start);
    const end = new Date(parsed.data.end);
    const maximumRangeMs = 370 * 24 * 60 * 60 * 1_000;
    if (end < start || end.getTime() - start.getTime() > maximumRangeMs) {
      return noStoreJson({ success: false, code: "INVALID_RANGE" }, { status: 400 });
    }
    const items = await listCanonicalCalendar({
      workspaceId: authz.workspaceId,
      start,
      end,
      socialAccountId: parsed.data.socialAccountId,
    });
    return noStoreJson({ success: true, schema: "calendar-projection/v1", items });
  },
);
