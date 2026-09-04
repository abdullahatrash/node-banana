import { describe, expect, it, vi } from "vitest";
import type { PublishingPlanDraft, PublishingPlanRevisionDto } from "@/lib/agent-runtime/publishing-plans/types";
import { CalendarRescheduleError, CalendarRescheduleService, type CalendarReschedulePorts } from "../calendar-reschedule";

const at = new Date("2026-09-04T10:00:00.000Z");
const digest = `sha256:${"a".repeat(64)}`;
function revision(): PublishingPlanRevisionDto {
  return { id: "revision_1", workspaceId: "workspace_1", planId: "plan_1", revision: 4, definitionDigest: digest, definition: { schema: "publishing-plan-revision-definition/v1", planId: "plan_1", channelIds: ["channel_1"], artifactIds: ["artifact_text"], targets: [{ targetId: "target_1", channelId: "channel_1", contentArtifactId: "artifact_text", mediaArtifactIds: [], settings: { type: "person" }, timing: { kind: "scheduled", publishAt: "2026-09-05T10:00:00.000Z" } }] }, validationEvidence: {} as PublishingPlanRevisionDto["validationEvidence"], author: { principalId: "principal_1", keyId: "key_1", creationAuthorizationEvidenceRef: "evidence" }, createdAt: at.toISOString() };
}
function ports(overrides: Partial<CalendarReschedulePorts> = {}): CalendarReschedulePorts {
  return { loadSource: vi.fn(async () => ({ revision: revision(), targetId: "target_1", approval: { id: "approval_1", consumed: false }, delivery: null })), cancelDelivery: vi.fn(), createPlanRevision: vi.fn(async ({ draft }: { draft: PublishingPlanDraft }) => ({ ...revision(), id: "revision_2", revision: 5, definition: { ...revision().definition, targets: draft.targets.map((target) => ({ ...target, timing: target.timing.kind === "now" ? { kind: "now" as const, publishAt: at.toISOString() } : { kind: "scheduled" as const, publishAt: target.timing.scheduledAt } })) } })), beginCommand: vi.fn(async () => ({ kind: "started" as const })), completeCommand: vi.fn(async () => undefined), ...overrides };
}
const input = { workspaceId: "workspace_1", userId: "user_1", initiator: { userId: "user_1", principalId: "human:user_1", keyId: "human-session:abc", authorizationEvidenceRef: "studio-auth:abc" }, approvalRequestId: "approval_1", revisionId: "revision_1", targetId: "target_1", expectedRevision: 4, scheduledAt: "2026-09-06T10:00:00.000Z", confirmCancelReleasedDelivery: false, idempotencyKey: "calendar-request-1" };

describe("Calendar canonical reschedule", () => {
  it("creates a newly validated immutable revision and supersedes an unconsumed Approval", async () => {
    const adapter = ports();
    const result = await new CalendarRescheduleService(adapter, () => at).reschedule(input);
    expect(result).toMatchObject({ kind: "rescheduled", supersededApprovalId: "approval_1", requiresApproval: true, revision: { revision: 5 } });
    expect(adapter.createPlanRevision).toHaveBeenCalledWith(expect.objectContaining({ expectedRevision: 4, draft: expect.objectContaining({ targets: [expect.objectContaining({ timing: { kind: "scheduled", scheduledAt: input.scheduledAt } })] }) }));
    expect(adapter.createPlanRevision).not.toHaveBeenCalledWith(expect.objectContaining({ principalId: "principal_1", keyId: "key_1" }));
    expect(adapter.beginCommand).toHaveBeenCalledWith(expect.objectContaining({ initiator: input.initiator, sourceRevisionId: "revision_1" }));
    expect(adapter.completeCommand).toHaveBeenCalledWith(expect.objectContaining({ result: expect.objectContaining({ kind: "rescheduled" }) }));
  });

  it("requires explicit cancellation before changing a released Delivery", async () => {
    const adapter = ports({ loadSource: vi.fn(async () => ({ revision: revision(), targetId: "target_1", approval: { id: "approval_1", consumed: true }, delivery: { id: "delivery_1", channelId: "channel_1", artifactIds: ["artifact_text"] } })) });
    await expect(new CalendarRescheduleService(adapter, () => at).reschedule(input)).rejects.toEqual(expect.objectContaining<Partial<CalendarRescheduleError>>({ code: "EXPLICIT_CANCELLATION_REQUIRED" }));
    expect(adapter.createPlanRevision).not.toHaveBeenCalled();
    expect(adapter.beginCommand).not.toHaveBeenCalled();
  });

  it("replays the durable human-attributed result without another revision", async () => {
    const replayed = { kind: "rescheduled" as const, revision: { ...revision(), id: "revision_2", revision: 5 }, supersededApprovalId: "approval_1", cancellation: null, requiresApproval: true as const };
    const adapter = ports({ beginCommand: vi.fn(async () => ({ kind: "replayed" as const, result: replayed })) });
    await expect(new CalendarRescheduleService(adapter, () => at).reschedule(input)).resolves.toEqual(replayed);
    expect(adapter.createPlanRevision).not.toHaveBeenCalled();
  });

  it("does not create a duplicate schedule when provider cancellation is not guaranteed", async () => {
    const cancellation = { schema: "publishing-delivery-cancellation/v1" as const, cancellationId: "cancel_1", deliveryId: "delivery_1", desiredState: "cancel" as const, stateAtRequest: "dispatching" as const, outcome: "conditional" as const, externallyCompletedAtRequest: null, requestedAt: at.toISOString(), durable: true as const, externallyReversed: false as const };
    const adapter = ports({ loadSource: vi.fn(async () => ({ revision: revision(), targetId: "target_1", approval: { id: "approval_1", consumed: true }, delivery: { id: "delivery_1", channelId: "channel_1", artifactIds: ["artifact_text"] } })), cancelDelivery: vi.fn(async () => cancellation) });
    await expect(new CalendarRescheduleService(adapter, () => at).reschedule({ ...input, confirmCancelReleasedDelivery: true })).resolves.toEqual({ kind: "cancellation_not_guaranteed", cancellation });
    expect(adapter.createPlanRevision).not.toHaveBeenCalled();
  });

  it("rejects stale revisions and non-canonical or past timestamps", async () => {
    const service = new CalendarRescheduleService(ports(), () => at);
    await expect(service.reschedule({ ...input, expectedRevision: 3 })).rejects.toEqual(expect.objectContaining({ code: "STALE_REVISION" }));
    await expect(service.reschedule({ ...input, scheduledAt: "2026-09-01T10:00:00.000Z" })).rejects.toEqual(expect.objectContaining({ code: "INVALID_INPUT" }));
  });
});
