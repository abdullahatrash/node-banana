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

const originalProjectionCookie = process.env.GOVERNANCE_MEMBERSHIP_PROJECTION_COOKIE;
const originalProjectionUser = process.env.GOVERNANCE_MEMBERSHIP_PROJECTION_USER_ID;

afterEach(() => {
  if (originalProjectionCookie === undefined) delete process.env.GOVERNANCE_MEMBERSHIP_PROJECTION_COOKIE;
  else process.env.GOVERNANCE_MEMBERSHIP_PROJECTION_COOKIE = originalProjectionCookie;
  if (originalProjectionUser === undefined) delete process.env.GOVERNANCE_MEMBERSHIP_PROJECTION_USER_ID;
  else process.env.GOVERNANCE_MEMBERSHIP_PROJECTION_USER_ID = originalProjectionUser;
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

  it("records retry timing and dead-letters after bounded transient failures", async () => {
    let now = new Date("2026-09-03T12:01:00.000Z");
    const repository = new InMemoryGovernanceRepository();
    const job = await queuedProjection(repository, "retry");
    const worker = new GovernanceMembershipProjectionWorker(repository, {
      apply: vi.fn().mockRejectedValue(new GovernanceMembershipProjectionError("BETTER_AUTH_DOWN", true)),
    }, { now: () => now });

    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const result = await worker.sweep({ limit: 10 });
      expect(result[attempt === 5 ? "deadLetter" : "retryPending"]).toBe(1);
      const current = await repository.getResource<{ attempts: number; nextAttemptAt: string | null; lastErrorCode: string }>({ workspaceId: actor.workspaceId, kind: "membership_projection", id: job.id });
      expect(current?.body.attempts).toBe(attempt);
      expect(current?.body.lastErrorCode).toBe("BETTER_AUTH_DOWN");
      if (attempt < 5) now = new Date(current!.body.nextAttemptAt!);
    }

    expect((await repository.getResource({ workspaceId: actor.workspaceId, kind: "membership_projection", id: job.id }))?.status).toBe("dead_letter");
  });

  it("fails closed and observably dead-letters non-retryable configuration errors", async () => {
    const repository = new InMemoryGovernanceRepository();
    const job = await queuedProjection(repository, "config");
    const worker = new GovernanceMembershipProjectionWorker(repository, {
      apply: vi.fn().mockRejectedValue(new GovernanceMembershipProjectionError("PROJECTION_CREDENTIAL_NOT_CONFIGURED", false)),
    }, { now: () => new Date("2026-09-03T12:01:00.000Z") });

    expect(await worker.sweep({ limit: 10 })).toMatchObject({ scanned: 1, deadLetter: 1 });
    expect(await repository.getResource({ workspaceId: actor.workspaceId, kind: "membership_projection", id: job.id })).toMatchObject({
      status: "dead_letter",
      body: { lastErrorCode: "PROJECTION_CREDENTIAL_NOT_CONFIGURED", attempts: 1 },
    });
  });

  it("never invokes Better Auth without the explicit projection credential", async () => {
    delete process.env.GOVERNANCE_MEMBERSHIP_PROJECTION_COOKIE;
    delete process.env.GOVERNANCE_MEMBERSHIP_PROJECTION_USER_ID;
    await expect(new BetterAuthOrganizationMembershipProjectionPort().apply({
      workspaceId: actor.workspaceId,
      operation: { operation: "update_role", userId: "member-a", role: "member" },
    })).rejects.toMatchObject({ code: "PROJECTION_CREDENTIAL_NOT_CONFIGURED", retryable: false });
  });
});
