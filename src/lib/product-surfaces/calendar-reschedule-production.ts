import "server-only";

import { dispatchCapability } from "@/lib/agent-runtime/server-dispatcher";
import { PRODUCTION_PUBLISHING_APPROVAL_REPOSITORY } from "@/lib/agent-runtime/publishing-approvals/production";
import { PRODUCTION_PUBLISHING_APPROVAL_REVISIONS } from "@/lib/agent-runtime/publishing-approvals/production";
import { PRODUCTION_PUBLISHING_APPROVAL_SERVICE } from "@/lib/agent-runtime/publishing-approvals/production";
import { publishingDeliveryCancelAuthorizationContractDigest } from "@/lib/agent-runtime/publishing-deliveries/authorization-contract";
import { PRODUCTION_PUBLISHING_DELIVERY_SERVICE } from "@/lib/agent-runtime/publishing-deliveries/production";
import { PRODUCTION_PUBLISHING_PLAN_SERVICE } from "@/lib/agent-runtime/publishing-plans/production";
import type { PublishingDeliveryCancellationDto } from "@/lib/agent-runtime/publishing-deliveries/types";
import type { PublishingPlanRevisionDto } from "@/lib/agent-runtime/publishing-plans/types";
import { CalendarRescheduleService, type CalendarReschedulePorts } from "./calendar-reschedule";
import { canonicalDigest } from "@/lib/agent-tools/canonical";
import { CalendarRescheduleCommandRepository } from "./calendar-reschedule-repository";

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
  const servicePrincipalId = process.env.CALENDAR_RESCHEDULE_AGENT_PRINCIPAL_ID;
  const serviceKeyId = process.env.CALENDAR_RESCHEDULE_AGENT_KEY_ID;
  if (!servicePrincipalId || !serviceKeyId) throw new Error("CALENDAR_RESCHEDULE_SERVICE_ACTOR_UNAVAILABLE");
  const receipts = new CalendarRescheduleCommandRepository({ principalId: servicePrincipalId, keyId: serviceKeyId });
  const ports: CalendarReschedulePorts = {
    async loadSource(sourceInput) {
      const currentRevision = await PRODUCTION_PUBLISHING_APPROVAL_REVISIONS.getCurrentRevision({ workspaceId: sourceInput.workspaceId, revisionId: sourceInput.revisionId });
      if (!currentRevision) return null;
      const revision = await PRODUCTION_PUBLISHING_PLAN_SERVICE.getRevision(sourceInput.workspaceId, sourceInput.revisionId);
      if (revision.planId !== sourceInput.planId) return null;
      const approvals = await PRODUCTION_PUBLISHING_APPROVAL_SERVICE.list({
        workspaceId: sourceInput.workspaceId,
        filters: { planRevisionId: sourceInput.revisionId },
        limit: 101,
        viewer: { kind: "human", userId: input.userId },
      });
      const approvalDto = approvals.find((candidate) => candidate.targetIds.includes(sourceInput.targetId)) ?? null;
      const approval = approvalDto
        ? await PRODUCTION_PUBLISHING_APPROVAL_REPOSITORY.getRequest({ workspaceId: sourceInput.workspaceId, approvalRequestId: approvalDto.id })
        : null;
      const deliveries = await PRODUCTION_PUBLISHING_DELIVERY_SERVICE.list({
        workspaceId: sourceInput.workspaceId,
        actor: { kind: "human", userId: input.userId },
        authorizedChannelIds: [],
        authorizedArtifactIds: [],
        filters: { planRevisionId: sourceInput.revisionId, targetId: sourceInput.targetId },
        limit: 10,
      });
      const delivery = deliveries[0] ?? null;
      if (delivery && (!approval || delivery.approvalRequestId !== approval.id)) return null;
      return {
        revision,
        targetId: sourceInput.targetId,
        approval: approval ? { id: approval.id, consumed: Boolean(approval.consumption) } : null,
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
      }, { securityContext: { kind: "agent", workspaceId: createInput.workspaceId, principalId: servicePrincipalId, keyId: serviceKeyId } }));
    },
    beginCommand: (commandInput) => receipts.begin(commandInput),
    completeCommand: (commandInput) => receipts.complete(commandInput),
  };
  return new CalendarRescheduleService(ports);
}

export function calendarRescheduleInitiator(input: { userId: string; authContextId: string }) {
  const contextDigest = canonicalDigest({ authContextId: input.authContextId }).slice(7);
  return {
    userId: input.userId,
    principalId: `human:${input.userId}`,
    keyId: `human-session:${contextDigest}`,
    authorizationEvidenceRef: `studio-auth:${contextDigest}`,
  };
}

export const CALENDAR_CANCELLATION_CONTRACT_DIGEST = publishingDeliveryCancelAuthorizationContractDigest();
