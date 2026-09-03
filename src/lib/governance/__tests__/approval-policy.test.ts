import { describe, expect, it } from "vitest";
import { advanceApprovalDeadline, createContentAcceptanceProgress, decideContentAcceptance } from "../approval-policy";
import type { ApprovalPolicyRevision } from "../types";
import { GovernanceApprovalDeadlineWorker } from "../approval-worker";
import { InMemoryGovernanceRepository } from "../memory-repository";
import { GovernanceService } from "../service";
import { canonicalDigest } from "@/lib/agent-tools/canonical";

const now = new Date("2026-09-03T12:00:00.000Z");
function policy(mode: ApprovalPolicyRevision["mode"], separationOfDuty = true): ApprovalPolicyRevision {
  return { schema: "approval-policy-revision/v1", revision: 1, purpose: "content_acceptance", mode, separationOfDuty, deadlineSeconds: 3600, escalationRoleIds: ["admin"], expiresAfterSeconds: 86400, createdByUserId: "owner", createdAt: now.toISOString() };
}

describe("Approval Policy evaluator", () => {
  it.each([
    { name: "single", mode: { kind: "single" as const, eligibleRoleIds: ["approver"] } },
    { name: "any-of", mode: { kind: "any_of" as const, eligibleRoleIds: ["creator", "approver"] } },
  ])("accepts $name with one eligible non-requester", ({ mode }) => {
    const revision = policy(mode);
    const accepted = decideContentAcceptance({ policy: revision, progress: createContentAcceptanceProgress({ policy: revision, requesterUserId: "requester", now }), userId: "approver-a", roleId: "approver", decision: "approve", now });
    expect(accepted).toMatchObject({ status: "accepted", authorizesExecution: false });
  });

  it("requires ordered distinct approvers for sequential separation of duty", () => {
    const revision = policy({ kind: "sequential", stages: [{ eligibleRoleIds: ["creator"] }, { eligibleRoleIds: ["approver"] }] });
    const initial = createContentAcceptanceProgress({ policy: revision, requesterUserId: "requester", now });
    const stageTwo = decideContentAcceptance({ policy: revision, progress: initial, userId: "creator-a", roleId: "creator", decision: "approve", now });
    expect(stageTwo).toMatchObject({ status: "pending", currentStage: 1 });
    const accepted = decideContentAcceptance({ policy: revision, progress: stageTwo, userId: "approver-b", roleId: "approver", decision: "approve", now });
    expect(accepted.status).toBe("accepted");
  });

  it("counts unique quorum decisions and escalates then expires on explicit deadlines", () => {
    const revision = policy({ kind: "quorum", eligibleRoleIds: ["approver"] , required: 2 });
    const initial = createContentAcceptanceProgress({ policy: revision, requesterUserId: "requester", now });
    const one = decideContentAcceptance({ policy: revision, progress: initial, userId: "approver-a", roleId: "approver", decision: "approve", now });
    expect(one.status).toBe("pending");
    expect(decideContentAcceptance({ policy: revision, progress: one, userId: "approver-b", roleId: "approver", decision: "approve", now }).status).toBe("accepted");
    const escalated = advanceApprovalDeadline({ policy: revision, progress: initial, now: new Date("2026-09-03T13:01:00.000Z") });
    expect(escalated).toMatchObject({ status: "escalated", escalatedAt: "2026-09-03T13:01:00.000Z" });
    expect(advanceApprovalDeadline({ policy: revision, progress: escalated, now: new Date("2026-09-04T12:01:00.000Z") }).status).toBe("expired");
  });

  it("rejects requester self-approval", () => {
    const revision = policy({ kind: "single", eligibleRoleIds: ["creator"] });
    const progress = createContentAcceptanceProgress({ policy: revision, requesterUserId: "requester", now });
    expect(() => decideContentAcceptance({ policy: revision, progress, userId: "requester", roleId: "creator", decision: "approve", now })).toThrow(/Separation of duty/);
  });

  it("durably sweeps due requests through escalation and expiry", async () => {
    let current = new Date(now);
    const repository = new InMemoryGovernanceRepository();
    const service = new GovernanceService(repository, { now: () => new Date(current) });
    const owner = { workspaceId: "workspace-a", userId: "owner-a", legacyRole: "owner" as const };
    const published = await service.execute(owner, { type: "publish_approval_policy", policy: { purpose: "content_acceptance", mode: { kind: "single", eligibleRoleIds: ["approver"] }, separationOfDuty: true, deadlineSeconds: 3600, escalationRoleIds: ["admin"], expiresAfterSeconds: 7200 } }, "deadline-policy-create") as { policyId: string; revision: { revision: number } };
    const request = await service.execute(owner, { type: "request_content_acceptance", policyId: published.policyId, policyRevision: published.revision.revision, resourceKind: "render_proof", resourceId: "proof-deadline", revisionDigest: canonicalDigest({ revision: 1 }) }, "deadline-request-create") as { requestId: string };
    const worker = new GovernanceApprovalDeadlineWorker(repository, { now: () => new Date(current) });
    current = new Date("2026-09-03T13:01:00.000Z");
    expect(await worker.processWorkspace(owner.workspaceId)).toBe(1);
    expect((await repository.getResource({ workspaceId: owner.workspaceId, kind: "approval_request", id: request.requestId }))?.status).toBe("escalated");
    current = new Date("2026-09-03T14:01:00.000Z");
    expect(await worker.processWorkspace(owner.workspaceId)).toBe(1);
    expect((await repository.getResource({ workspaceId: owner.workspaceId, kind: "approval_request", id: request.requestId }))?.status).toBe("expired");
  });
});
