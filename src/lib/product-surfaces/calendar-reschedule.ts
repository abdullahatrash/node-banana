import { canonicalDigest } from "@/lib/agent-tools/canonical";
import type { PublishingDeliveryCancellationDto } from "@/lib/agent-runtime/publishing-deliveries/types";
import type { PublishingPlanDraft, PublishingPlanRevisionDto } from "@/lib/agent-runtime/publishing-plans/types";

export interface CalendarRescheduleSource {
  revision: PublishingPlanRevisionDto;
  targetId: string;
  approval: { id: string; consumed: boolean } | null;
  delivery: { id: string; channelId: string; artifactIds: string[] } | null;
}

export interface CalendarReschedulePorts {
  loadSource(input: { workspaceId: string; approvalRequestId: string; revisionId: string; targetId: string }): Promise<CalendarRescheduleSource | null>;
  cancelDelivery(input: { workspaceId: string; userId: string; deliveryId: string; channelIds: string[]; artifactIds: string[] }): Promise<PublishingDeliveryCancellationDto>;
  createPlanRevision(input: {
    workspaceId: string;
    principalId: string;
    keyId: string;
    draft: PublishingPlanDraft;
    expectedRevision: number;
    idempotencyKey: string;
  }): Promise<PublishingPlanRevisionDto>;
}

export type CalendarRescheduleResult =
  | { kind: "rescheduled"; revision: PublishingPlanRevisionDto; supersededApprovalId: string | null; cancellation: PublishingDeliveryCancellationDto | null; requiresApproval: true }
  | { kind: "cancellation_not_guaranteed"; cancellation: PublishingDeliveryCancellationDto };

export class CalendarRescheduleError extends Error {
  constructor(readonly code: "INVALID_INPUT" | "NOT_FOUND" | "STALE_REVISION" | "EXPLICIT_CANCELLATION_REQUIRED" | "INCONSISTENT_RELEASE") { super(code); }
}

function canonicalFuture(value: string, now: Date): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== value || date <= now) throw new CalendarRescheduleError("INVALID_INPUT");
  return date.toISOString();
}

function createDraft(source: CalendarRescheduleSource, scheduledAt: string): PublishingPlanDraft {
  const definition = source.revision.definition;
  return {
    schema: "publishing-plan-draft/v1",
    planId: definition.planId,
    channelIds: [...definition.channelIds],
    artifactIds: [...definition.artifactIds],
    targets: definition.targets.map((target) => ({
      targetId: target.targetId,
      channelId: target.channelId,
      contentArtifactId: target.contentArtifactId,
      mediaArtifactIds: [...target.mediaArtifactIds],
      settings: structuredClone(target.settings),
      timing: target.targetId === source.targetId
        ? { kind: "scheduled", scheduledAt }
        : target.timing.kind === "now"
          ? { kind: "now" }
          : { kind: "scheduled", scheduledAt: target.timing.publishAt },
    })),
  };
}

export class CalendarRescheduleService {
  constructor(private readonly ports: CalendarReschedulePorts, private readonly now: () => Date = () => new Date()) {}

  async reschedule(input: {
    workspaceId: string;
    userId: string;
    revisionId: string;
    approvalRequestId: string;
    targetId: string;
    expectedRevision: number;
    scheduledAt: string;
    confirmCancelReleasedDelivery: boolean;
    idempotencyKey: string;
  }): Promise<CalendarRescheduleResult> {
    if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 1 || !/^[!-~]{8,200}$/.test(input.idempotencyKey)) throw new CalendarRescheduleError("INVALID_INPUT");
    const scheduledAt = canonicalFuture(input.scheduledAt, this.now());
    const source = await this.ports.loadSource({ workspaceId: input.workspaceId, approvalRequestId: input.approvalRequestId, revisionId: input.revisionId, targetId: input.targetId });
    if (!source) throw new CalendarRescheduleError("NOT_FOUND");
    if (source.revision.workspaceId !== input.workspaceId || source.revision.id !== input.revisionId || source.revision.revision !== input.expectedRevision || !source.revision.definition.targets.some((target) => target.targetId === input.targetId)) throw new CalendarRescheduleError("STALE_REVISION");
    if (source.approval?.consumed && !source.delivery) throw new CalendarRescheduleError("INCONSISTENT_RELEASE");

    let cancellation: PublishingDeliveryCancellationDto | null = null;
    if (source.delivery) {
      if (!source.approval?.consumed) throw new CalendarRescheduleError("INCONSISTENT_RELEASE");
      if (!input.confirmCancelReleasedDelivery) throw new CalendarRescheduleError("EXPLICIT_CANCELLATION_REQUIRED");
      cancellation = await this.ports.cancelDelivery({ workspaceId: input.workspaceId, userId: input.userId, deliveryId: source.delivery.id, channelIds: [source.delivery.channelId], artifactIds: [...source.delivery.artifactIds] });
      if (cancellation.outcome !== "prevented") return { kind: "cancellation_not_guaranteed", cancellation };
    }

    const revision = await this.ports.createPlanRevision({
      workspaceId: input.workspaceId,
      principalId: source.revision.author.principalId,
      keyId: source.revision.author.keyId,
      draft: createDraft(source, scheduledAt),
      expectedRevision: input.expectedRevision,
      idempotencyKey: `calendar:${canonicalDigest({ key: input.idempotencyKey, revisionId: input.revisionId, targetId: input.targetId, scheduledAt }).slice(7)}`,
    });
    return {
      kind: "rescheduled",
      revision,
      supersededApprovalId: source.approval && !source.approval.consumed ? source.approval.id : null,
      cancellation,
      requiresApproval: true,
    };
  }
}
