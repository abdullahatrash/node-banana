import { describe, expect, it } from "vitest";
import { InMemoryGovernanceRepository } from "../memory-repository";
import { GovernanceService } from "../service";
import { RepositoryGovernanceStepUpVerifier } from "../step-up";

const now = new Date("2026-09-03T12:00:00.000Z");
const actor = { workspaceId: "workspace-1", userId: "owner-1", legacyRole: "owner" as const };

describe("RepositoryGovernanceStepUpVerifier", () => {
  it("accepts only the exact Workspace, principal, purpose, resource, token, and active window", async () => {
    const repository = new InMemoryGovernanceRepository();
    const service = new GovernanceService(repository, { now: () => now });
    const challenge = await service.execute(actor, { type: "begin_step_up", purpose: "credential.replace", resourceId: "profile-1" }, "begin-step-up") as { challengeId: string; verificationCode: string };
    const verified = await service.execute(actor, { type: "verify_step_up", challengeId: challenge.challengeId, code: challenge.verificationCode }, "verify-step-up") as { stepUpToken: string };
    const verifier = new RepositoryGovernanceStepUpVerifier(repository);
    const input = { workspaceId: actor.workspaceId, userId: actor.userId, purpose: "credential.replace", resourceId: "profile-1", token: verified.stepUpToken, evaluatedAt: now };
    await expect(verifier.verify(input)).resolves.toMatchObject({ schema: "governance-step-up-evidence/v1", workspaceId: actor.workspaceId, userId: actor.userId, purpose: "credential.replace", resourceId: "profile-1" });
    for (const changed of [
      { workspaceId: "workspace-2" }, { userId: "owner-2" }, { purpose: "agent.key.create" }, { resourceId: "profile-2" }, { token: "wrong-token" }, { evaluatedAt: new Date("2026-09-03T12:16:00.000Z") },
    ]) await expect(verifier.verify({ ...input, ...changed })).resolves.toBeNull();
  });
});
