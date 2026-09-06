import { describe, expect, it, vi } from "vitest";
import { InMemoryGovernanceRepository } from "../memory-repository";
import { GovernanceSafetyAppealWorker } from "../safety-appeal-worker";
import { GovernanceService } from "../service";

const now = new Date("2026-09-03T12:00:00.000Z");
const actor = { workspaceId: "workspace-1", userId: "owner-1", legacyRole: "owner" as const, authContextId: "session-owner-1" };

async function queuedAppeal(repository: InMemoryGovernanceRepository) {
  const service = new GovernanceService(repository, { now: () => now });
  const decision = await service.execute(actor, { type: "create_safety_decision", intentRef: "run-1", reasonCode: "POLICY_BLOCK", policyVersion: "safety-v1", safeExplanation: "Blocked", evidenceRef: "evidence-1", remediation: "Appeal", appealEligible: true }, "create-decision") as { decisionId: string };
  const appeal = await service.execute(actor, { type: "appeal_safety_decision", decisionId: decision.decisionId, explanation: "New consent" }, "create-appeal") as { appealId: string };
  await service.execute(actor, { type: "resolve_safety_appeal", appealId: appeal.appealId, outcome: "reevaluate_exact_intent", currentRevalidationRequired: true }, "queue-revalidation");
  return { ...appeal, decisionId: decision.decisionId };
}

describe("GovernanceSafetyAppealWorker", () => {
  it("resumes only after successful exact-intent evaluation under current policy", async () => {
    const repository = new InMemoryGovernanceRepository();
    const ids = await queuedAppeal(repository);
    const revalidate = vi.fn(async () => ({ outcome: "allowed" as const, currentPolicyVersion: "safety-v2", evidenceRef: "evidence-2", safeExplanation: "Consent verified" }));
    await new GovernanceSafetyAppealWorker(repository, { revalidate }, { now: () => new Date("2026-09-03T12:01:00.000Z") }).process({ workspaceId: actor.workspaceId, appealId: ids.appealId });
    expect(revalidate).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: actor.workspaceId, intentRef: "run-1", originalDecisionId: ids.decisionId, originalPolicyVersion: "safety-v1", originalEvidenceRef: "evidence-1" }));
    expect(await repository.getResource({ workspaceId: actor.workspaceId, kind: "safety_appeal", id: ids.appealId })).toMatchObject({ status: "revalidated_allowed", body: { canResume: true, currentRevalidationRequired: false, revalidation: { currentPolicyVersion: "safety-v2", exactIntentRef: "run-1" } } });
    expect(await repository.getResource({ workspaceId: actor.workspaceId, kind: "safety_decision", id: ids.decisionId })).toMatchObject({ status: "superseded_after_revalidation" });
  });

  it("fails closed when current-policy revalidation is unavailable", async () => {
    const repository = new InMemoryGovernanceRepository();
    const ids = await queuedAppeal(repository);
    await new GovernanceSafetyAppealWorker(repository).process({ workspaceId: actor.workspaceId, appealId: ids.appealId });
    expect(await repository.getResource({ workspaceId: actor.workspaceId, kind: "safety_appeal", id: ids.appealId })).toMatchObject({ status: "resolved_upheld", body: { canResume: false, currentRevalidationRequired: false } });
    expect(await repository.getResource({ workspaceId: actor.workspaceId, kind: "safety_decision", id: ids.decisionId })).toMatchObject({ status: "active" });
  });
});
