import { afterEach, describe, expect, it, vi } from "vitest";
import { InMemoryGovernanceRepository } from "../memory-repository";
import {
  GovernanceMembershipProjectionError,
  GovernanceMembershipProjectionWorker,
  BetterAuthOrganizationMembershipProjectionPort,
} from "../membership-projection-worker";
import { GovernanceService } from "../service";

const actor = {
  workspaceId: "workspace-a",
  userId: "owner-a",
  legacyRole: "owner" as const,
  authContextId: "session-owner-a",
};

const originalProjectionUrl = process.env.GOVERNANCE_MEMBERSHIP_PROJECTION_URL;
const originalProjectionKeyId = process.env.GOVERNANCE_MEMBERSHIP_PROJECTION_KEY_ID;
const originalProjectionKey = process.env.GOVERNANCE_MEMBERSHIP_PROJECTION_SIGNING_KEY;

afterEach(() => {
  if (originalProjectionUrl === undefined) delete process.env.GOVERNANCE_MEMBERSHIP_PROJECTION_URL;
  else process.env.GOVERNANCE_MEMBERSHIP_PROJECTION_URL = originalProjectionUrl;
  if (originalProjectionKeyId === undefined) delete process.env.GOVERNANCE_MEMBERSHIP_PROJECTION_KEY_ID;
  else process.env.GOVERNANCE_MEMBERSHIP_PROJECTION_KEY_ID = originalProjectionKeyId;
  if (originalProjectionKey === undefined) delete process.env.GOVERNANCE_MEMBERSHIP_PROJECTION_SIGNING_KEY;
  else process.env.GOVERNANCE_MEMBERSHIP_PROJECTION_SIGNING_KEY = originalProjectionKey;
});

async function queuedProjection(repository: InMemoryGovernanceRepository, suffix: string) {
  const service = new GovernanceService(repository, { now: () => new Date("2026-09-03T12:00:00.000Z") });
  await service.execute(actor, {
    type: "assign_role",
    userId: `member-${suffix}`,
    binding: { kind: "built_in", role: "viewer" },
  }, `queue-projection-${suffix}`);
  return (await repository.listResources({ workspaceId: actor.workspaceId, kinds: ["membership_projection"] }))[0];
}

describe("GovernanceMembershipProjectionWorker", () => {
  it("claims and completes an exact Better Auth membership projection once", async () => {
    const repository = new InMemoryGovernanceRepository();
    const job = await queuedProjection(repository, "success");
    const apply = vi.fn().mockResolvedValue(undefined);
    const worker = new GovernanceMembershipProjectionWorker(repository, { apply }, { now: () => new Date("2026-09-03T12:01:00.000Z") });

    const [first, second] = await Promise.all([
      worker.sweep({ limit: 10 }),
      worker.sweep({ limit: 10 }),
    ]);

    expect(first.succeeded + second.succeeded).toBe(1);
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledWith({
      workspaceId: actor.workspaceId,
      operation: { operation: "update_role", userId: "member-success", role: "member" },
    });
    expect((await repository.getResource({ workspaceId: actor.workspaceId, kind: "membership_projection", id: job.id }))?.status).toBe("succeeded");
  });

  it("keeps transient failures replayable and raises an operator alert after the bounded threshold", async () => {
    let now = new Date("2026-09-03T12:01:00.000Z");
    const repository = new InMemoryGovernanceRepository();
    const job = await queuedProjection(repository, "retry");
    const worker = new GovernanceMembershipProjectionWorker(repository, {
      apply: vi.fn().mockRejectedValue(new GovernanceMembershipProjectionError("BETTER_AUTH_DOWN", true)),
    }, { now: () => now });

    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const result = await worker.sweep({ limit: 10 });
      expect(result.retryPending).toBe(1);
      const current = await repository.getResource<{ attempts: number; nextAttemptAt: string | null; lastErrorCode: string; operatorAlertRequired: boolean }>({ workspaceId: actor.workspaceId, kind: "membership_projection", id: job.id });
      expect(current?.body.attempts).toBe(attempt);
      expect(current?.body.lastErrorCode).toBe("BETTER_AUTH_DOWN");
      expect(current?.body.operatorAlertRequired).toBe(attempt >= 5);
      if (attempt < 5) now = new Date(current!.body.nextAttemptAt!);
    }

    expect((await repository.getResource({ workspaceId: actor.workspaceId, kind: "membership_projection", id: job.id }))?.status).toBe("retry_pending");
  });

  it("keeps configuration outages retryable and operator-visible", async () => {
    const repository = new InMemoryGovernanceRepository();
    const job = await queuedProjection(repository, "config");
    const worker = new GovernanceMembershipProjectionWorker(repository, {
      apply: vi.fn().mockRejectedValue(new GovernanceMembershipProjectionError("PROJECTION_CREDENTIAL_NOT_CONFIGURED", true)),
    }, { now: () => new Date("2026-09-03T12:01:00.000Z") });

    expect(await worker.sweep({ limit: 10 })).toMatchObject({ scanned: 1, retryPending: 1, deadLetter: 0 });
    expect(await repository.getResource({ workspaceId: actor.workspaceId, kind: "membership_projection", id: job.id })).toMatchObject({
      status: "retry_pending",
      body: { lastErrorCode: "PROJECTION_CREDENTIAL_NOT_CONFIGURED", attempts: 1 },
    });
  });

  it("never invokes Better Auth without the explicit projection credential", async () => {
    delete process.env.GOVERNANCE_MEMBERSHIP_PROJECTION_URL;
    delete process.env.GOVERNANCE_MEMBERSHIP_PROJECTION_KEY_ID;
    delete process.env.GOVERNANCE_MEMBERSHIP_PROJECTION_SIGNING_KEY;
    await expect(new BetterAuthOrganizationMembershipProjectionPort().apply({
      workspaceId: actor.workspaceId,
      operation: { operation: "update_role", userId: "member-a", role: "member" },
    })).rejects.toMatchObject({ code: "PROJECTION_CREDENTIAL_NOT_CONFIGURED", retryable: true });
  });
});
