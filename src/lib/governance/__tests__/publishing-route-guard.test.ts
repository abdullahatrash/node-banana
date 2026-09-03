import { describe, expect, it } from "vitest";
import { InMemoryGovernanceRepository } from "../memory-repository";
import { GovernanceService } from "../service";
import { requiresGovernedPublishingPlan } from "../publishing-route-guard";

const actor = { workspaceId: "workspace-a", userId: "owner-a", legacyRole: "owner" as const };

describe("legacy publishing route guard", () => {
  it("fails closed when the Workspace has an active Publishing Approval policy", async () => {
    const repository = new InMemoryGovernanceRepository();
    const service = new GovernanceService(repository, { now: () => new Date("2026-09-03T12:00:00.000Z") });
    expect(await requiresGovernedPublishingPlan(actor.workspaceId, repository)).toBe(false);
    await service.execute(actor, { type: "publish_approval_policy", policy: { purpose: "publishing_approval", mode: { kind: "single", eligibleRoleIds: ["explicit-approver"] }, separationOfDuty: true, deadlineSeconds: 3600, escalationRoleIds: [], expiresAfterSeconds: 7200 } }, "publishing-policy-route-guard");
    expect(await requiresGovernedPublishingPlan(actor.workspaceId, repository)).toBe(true);
  });

  it("does not confuse Content Acceptance with Publishing Approval", async () => {
    const repository = new InMemoryGovernanceRepository();
    const service = new GovernanceService(repository, { now: () => new Date("2026-09-03T12:00:00.000Z") });
    await service.execute(actor, { type: "publish_approval_policy", policy: { purpose: "content_acceptance", mode: { kind: "single", eligibleRoleIds: ["approver"] }, separationOfDuty: false, deadlineSeconds: 3600, escalationRoleIds: [], expiresAfterSeconds: 7200 } }, "content-policy-route-guard");
    expect(await requiresGovernedPublishingPlan(actor.workspaceId, repository)).toBe(false);
  });
});
