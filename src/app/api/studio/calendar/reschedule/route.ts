import { NextRequest } from "next/server";
import { z } from "zod";
import { noStoreJson } from "@/lib/agent-auth/http-request";
import { CalendarRescheduleError } from "@/lib/product-surfaces/calendar-reschedule";
import { calendarRescheduleInitiator, productionCalendarRescheduleService } from "@/lib/product-surfaces/calendar-reschedule-production";
import { withStudioAuth } from "@/lib/studio/withStudioAuth";
import { getSocialPost } from "@/lib/social/repository";
import { parseGovernedPublishingMarker } from "@/lib/agent-tools/social-publishing-approval";
import { PRODUCTION_PUBLISHING_APPROVAL_REPOSITORY } from "@/lib/agent-runtime/publishing-approvals/production";
import { PRODUCTION_PUBLISHING_PLAN_SERVICE } from "@/lib/agent-runtime/publishing-plans/production";

const id = z.string().min(1).max(200).regex(/^[A-Za-z0-9_-]+$/);
const command = z.object({
  postId: id,
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
      const post = await getSocialPost(authz.workspaceId, parsed.data.postId);
      const marker = parseGovernedPublishingMarker(post.triggerSource);
      if (!marker) return noStoreJson({ success: false, code: "CANONICAL_SCHEDULE_UNAVAILABLE" }, { status: 409 });
      const approval = await PRODUCTION_PUBLISHING_APPROVAL_REPOSITORY.getRequest({ workspaceId: authz.workspaceId, approvalRequestId: marker.approvalRequestId });
      if (!approval || !approval.targetIds.includes(marker.targetId)) return noStoreJson({ success: false, code: "NOT_FOUND" }, { status: 404 });
      const source = await PRODUCTION_PUBLISHING_PLAN_SERVICE.getRevision(authz.workspaceId, approval.planRevisionId);
      const result = await productionCalendarRescheduleService({ userId: authz.userId, role: authz.role, authContextId: authz.authContextId }).reschedule({
        ...parsed.data,
        workspaceId: authz.workspaceId,
        userId: authz.userId,
        initiator: calendarRescheduleInitiator({ userId: authz.userId, authContextId: authz.authContextId }),
        approvalRequestId: approval.id,
        revisionId: source.id,
        targetId: marker.targetId,
        expectedRevision: source.revision,
      });
      return noStoreJson({ success: true, result });
    } catch (error) {
      const code = error instanceof CalendarRescheduleError ? error.code : error instanceof Error ? error.name : "CALENDAR_RESCHEDULE_UNAVAILABLE";
      const status = code === "NOT_FOUND" ? 404 : code === "INVALID_INPUT" ? 400 : code === "EXPLICIT_CANCELLATION_REQUIRED" || code === "STALE_REVISION" || code === "INCONSISTENT_RELEASE" || code === "IDEMPOTENCY_CONFLICT" ? 409 : 503;
      return noStoreJson({ success: false, code }, { status });
    }
  },
);
