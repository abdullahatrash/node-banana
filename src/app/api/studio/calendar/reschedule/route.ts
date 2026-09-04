import { NextRequest } from "next/server";
import { z } from "zod";
import { noStoreJson } from "@/lib/agent-auth/http-request";
import { CalendarRescheduleError } from "@/lib/product-surfaces/calendar-reschedule";
import { calendarRescheduleInitiator, productionCalendarRescheduleService } from "@/lib/product-surfaces/calendar-reschedule-production";
import { withStudioAuth } from "@/lib/studio/withStudioAuth";

const id = z.string().min(1).max(200).regex(/^[A-Za-z0-9_-]+$/);
const digest = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const command = z.object({
  source: z.object({
    schema: z.literal("canonical-calendar-binding/v1"),
    planId: id,
    revisionId: id,
    revision: z.number().int().positive(),
    revisionDigest: digest,
    targetId: id,
  }).strict(),
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
        scheduledAt: parsed.data.scheduledAt,
        confirmCancelReleasedDelivery: parsed.data.confirmCancelReleasedDelivery,
        idempotencyKey: parsed.data.idempotencyKey,
        workspaceId: authz.workspaceId,
        userId: authz.userId,
        initiator: calendarRescheduleInitiator({ userId: authz.userId, authContextId: authz.authContextId }),
        planId: parsed.data.source.planId,
        revisionId: parsed.data.source.revisionId,
        revisionDigest: parsed.data.source.revisionDigest,
        targetId: parsed.data.source.targetId,
        expectedRevision: parsed.data.source.revision,
      });
      return noStoreJson({ success: true, result });
    } catch (error) {
      const code = error instanceof CalendarRescheduleError ? error.code : error instanceof Error ? error.name : "CALENDAR_RESCHEDULE_UNAVAILABLE";
      const status = code === "NOT_FOUND" ? 404 : code === "INVALID_INPUT" ? 400 : code === "EXPLICIT_CANCELLATION_REQUIRED" || code === "STALE_REVISION" || code === "INCONSISTENT_RELEASE" || code === "IDEMPOTENCY_CONFLICT" ? 409 : 503;
      return noStoreJson({ success: false, code }, { status });
    }
  },
);
