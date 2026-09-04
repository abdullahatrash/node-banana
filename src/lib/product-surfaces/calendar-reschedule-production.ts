import "server-only";

import { dispatchCapability } from "@/lib/agent-runtime/server-dispatcher";
import { PRODUCTION_PUBLISHING_APPROVAL_REPOSITORY } from "@/lib/agent-runtime/publishing-approvals/production";
import { PRODUCTION_PUBLISHING_APPROVAL_REVISIONS } from "@/lib/agent-runtime/publishing-approvals/production";
import { publishingDeliveryCancelAuthorizationContractDigest } from "@/lib/agent-runtime/publishing-deliveries/authorization-contract";
import { PRODUCTION_PUBLISHING_DELIVERY_SERVICE } from "@/lib/agent-runtime/publishing-deliveries/production";
import { PRODUCTION_PUBLISHING_PLAN_SERVICE } from "@/lib/agent-runtime/publishing-plans/production";
import type { PublishingDeliveryCancellationDto } from "@/lib/agent-runtime/publishing-deliveries/types";
import type { PublishingPlanRevisionDto } from "@/lib/agent-runtime/publishing-plans/types";
import { CalendarRescheduleService, type CalendarReschedulePorts } from "./calendar-reschedule";

function capabilityResult<T>(response: Awaited<ReturnType<typeof dispatchCapability>>): T {
  if (response.type === "capability_error") {
    const error = new Error(response.message);
    error.name = response.code;
    throw error;
  }
  return response.output as T;
}

export function productionCalendarRescheduleService(input: {
  userId: string;
  role: "owner" | "admin" | "member";
  authContextId: string;
}): CalendarRescheduleService {
  const ports: CalendarReschedulePorts = {
    async loadSource(sourceInput) {
      const approval = await PRODUCTION_PUBLISHING_APPROVAL_REPOSITORY.getRequest({ workspaceId: sourceInput.workspaceId, approvalRequestId: sourceInput.approvalRequestId });
      if (!approval || approval.planRevisionId !== sourceInput.revisionId || !approval.targetIds.includes(sourceInput.targetId)) return null;
      const currentRevision = await PRODUCTION_PUBLISHING_APPROVAL_REVISIONS.getCurrentRevision({ workspaceId: sourceInput.workspaceId, revisionId: sourceInput.revisionId });
      if (!currentRevision) return null;
      const revision = await PRODUCTION_PUBLISHING_PLAN_SERVICE.getRevision(sourceInput.workspaceId, sourceInput.revisionId);
      const deliveries = await PRODUCTION_PUBLISHING_DELIVERY_SERVICE.list({
        workspaceId: sourceInput.workspaceId,
        actor: { kind: "human", userId: input.userId },
        authorizedChannelIds: [],
        authorizedArtifactIds: [],
        filters: { planRevisionId: sourceInput.revisionId, targetId: sourceInput.targetId },
        limit: 10,
      });
      const delivery = deliveries.find((candidate) => candidate.approvalRequestId === approval.id) ?? null;
      return {
        revision,
        targetId: sourceInput.targetId,
        approval: { id: approval.id, consumed: Boolean(approval.consumption) },
        delivery: delivery ? { id: delivery.id, channelId: delivery.channelId, artifactIds: [...delivery.artifactIds] } : null,
      };
    },
    async cancelDelivery(cancelInput) {
      return capabilityResult<PublishingDeliveryCancellationDto>(await dispatchCapability({
        capability: "publishing_deliveries.cancel@1",
        input: { deliveryId: cancelInput.deliveryId, channelIds: cancelInput.channelIds, artifactIds: cancelInput.artifactIds },
      }, { securityContext: { kind: "human", workspaceId: cancelInput.workspaceId, userId: cancelInput.userId, role: input.role, authContextId: input.authContextId } }));
    },
    async createPlanRevision(createInput) {
      return capabilityResult<PublishingPlanRevisionDto>(await dispatchCapability({
        capability: "publishing_plan_revisions.create@1",
        input: { idempotencyKey: createInput.idempotencyKey, expectedRevision: createInput.expectedRevision, draft: createInput.draft },
      }, { securityContext: { kind: "agent", workspaceId: createInput.workspaceId, principalId: createInput.principalId, keyId: createInput.keyId } }));
    },
  };
  return new CalendarRescheduleService(ports);
}

export const CALENDAR_CANCELLATION_CONTRACT_DIGEST = publishingDeliveryCancelAuthorizationContractDigest();
