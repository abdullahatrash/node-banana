import { NextRequest } from "next/server";
import { z } from "zod";
import { noStoreJson } from "@/lib/agent-auth/http-request";
import { CalendarRescheduleError } from "@/lib/product-surfaces/calendar-reschedule";
import { productionCalendarRescheduleService } from "@/lib/product-surfaces/calendar-reschedule-production";
import { withStudioAuth } from "@/lib/studio/withStudioAuth";

const id = z.string().min(1).max(200).regex(/^[A-Za-z0-9_-]+$/);
const command = z.object({
  approvalRequestId: id,
  revisionId: id,
  targetId: id,
  expectedRevision: z.number().int().min(1),
  scheduledAt: z.string().datetime({ offset: true }),
  confirmCancelReleasedDelivery: z.boolean(),
  idempotencyKey: z.string().min(8).max(200).regex(/^[!-~]+$/),
}).strict();

export const POST = withStudioAuth<undefined>(
  { route: "/api/studio/calendar/reschedule", action: "write", permission: "social:publish" },
  async (request: NextRequest, authz) => {
    const parsed = command.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return noStoreJson({ success: false, code: "INVALID_INPUT" }, { status: 400 });
    try {
      const result = await productionCalendarRescheduleService({ userId: authz.userId, role: authz.role, authContextId: authz.authContextId }).reschedule({
        ...parsed.data,
        workspaceId: authz.workspaceId,
        userId: authz.userId,
      });
      return noStoreJson({ success: true, result });
    } catch (error) {
      const code = error instanceof CalendarRescheduleError ? error.code : error instanceof Error ? error.name : "CALENDAR_RESCHEDULE_UNAVAILABLE";
      const status = code === "NOT_FOUND" ? 404 : code === "INVALID_INPUT" ? 400 : code === "EXPLICIT_CANCELLATION_REQUIRED" || code === "STALE_REVISION" || code === "INCONSISTENT_RELEASE" ? 409 : 503;
      return noStoreJson({ success: false, code }, { status });
    }
  },
);
