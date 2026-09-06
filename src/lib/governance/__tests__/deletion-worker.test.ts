import { describe, expect, it, vi } from "vitest";
import { GovernanceDeletionWorker } from "../deletion-worker";
import { InMemoryGovernanceRepository } from "../memory-repository";
import { GovernanceService } from "../service";
import { RETENTION_CLASSES, type RetentionRule } from "../types";
import { TRUSTED_RETENTION_LEGAL_FLOORS } from "../retention-policy";

const now = new Date("2026-09-03T12:00:00.000Z");
const actor = { workspaceId: "workspace-1", userId: "owner-1", legacyRole: "owner" as const, authContextId: "session-owner-1" };

async function requestDeletion(repository: InMemoryGovernanceRepository, options: { durationDays?: number; createdAt?: Date } = {}) {
  const service = new GovernanceService(repository, { now: () => now }, undefined, undefined, undefined, undefined, undefined, { resolve: async ({ resourceId }) => ({ resourceKind: "media", resourceId, retentionClass: "workspace_media", createdAt: options.createdAt ?? new Date("2026-08-01T00:00:00.000Z"), authoritativeSystems: ["primary", "replica"] }) });
  const manageChallenge = await service.execute(actor, { type: "begin_step_up", purpose: "retention.manage", resourceId: null }, "begin-manage") as { challengeId: string; verificationCode: string };
  const manageSession = await service.execute(actor, { type: "verify_step_up", challengeId: manageChallenge.challengeId, code: manageChallenge.verificationCode }, "verify-manage") as { stepUpToken: string };
  const rules: RetentionRule[] = RETENTION_CLASSES.map((retentionClass) => ({ retentionClass, durationDays: retentionClass === "workspace_media" ? options.durationDays ?? TRUSTED_RETENTION_LEGAL_FLOORS[retentionClass] : TRUSTED_RETENTION_LEGAL_FLOORS[retentionClass], recoverableDays: 0, legalFloorDays: TRUSTED_RETENTION_LEGAL_FLOORS[retentionClass] }));
  await service.execute(actor, { type: "publish_retention_policy", rules, stepUpToken: manageSession.stepUpToken }, "publish-retention");
  const challenge = await service.execute(actor, { type: "begin_step_up", purpose: "retention.delete", resourceId: "asset-1" }, "begin-delete") as { challengeId: string; verificationCode: string };
  const session = await service.execute(actor, { type: "verify_step_up", challengeId: challenge.challengeId, code: challenge.verificationCode }, "verify-delete") as { stepUpToken: string };
  return service.execute(actor, { type: "record_deletion", resourceKind: "media", resourceId: "asset-1", stepUpToken: session.stepUpToken }, "request-delete") as Promise<{ deletionReceiptId: string; status: string; tombstoneId: null }>;
}

describe("GovernanceDeletionWorker", () => {
  it("creates a tombstone only after every authoritative adapter outcome is durable", async () => {
    const repository = new InMemoryGovernanceRepository();
    const requested = await requestDeletion(repository);
    expect(requested).toMatchObject({ status: "queued", tombstoneId: null });
    expect(await repository.getResource({ workspaceId: actor.workspaceId, kind: "tombstone", id: "media:asset-1" })).toBeNull();
    const remove = vi.fn(async ({ system, idempotencyKey }: { system: string; idempotencyKey: string }) => ({ state: system === "primary" ? "deleted" as const : "not_found" as const, evidenceRef: `${system}:${idempotencyKey}` }));
    await new GovernanceDeletionWorker(repository, { delete: remove }, { now: () => new Date("2026-09-03T12:01:00.000Z") }).process({ workspaceId: actor.workspaceId, deletionReceiptId: requested.deletionReceiptId });
    const receipt = await repository.getResource<{ outcomes: Record<string, { state: string }> }>({ workspaceId: actor.workspaceId, kind: "deletion_receipt", id: requested.deletionReceiptId });
    expect(receipt).toMatchObject({ status: "completed", body: { outcomes: { primary: { state: "deleted" }, replica: { state: "not_found" } } } });
    expect(await repository.getResource({ workspaceId: actor.workspaceId, kind: "tombstone", id: "media:asset-1" })).toMatchObject({ status: "active" });
    expect(remove).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: actor.workspaceId, idempotencyKey: `${requested.deletionReceiptId}:primary` }));
  });

  it("does not claim deletion when an adapter is absent or its outcome is ambiguous", async () => {
    for (const mode of ["absent", "ambiguous"] as const) {
      const repository = new InMemoryGovernanceRepository();
      const requested = await requestDeletion(repository);
      const worker = mode === "absent" ? new GovernanceDeletionWorker(repository) : new GovernanceDeletionWorker(repository, { delete: async () => { throw new Error("transport"); } });
      await worker.process({ workspaceId: actor.workspaceId, deletionReceiptId: requested.deletionReceiptId });
      expect((await repository.getResource({ workspaceId: actor.workspaceId, kind: "deletion_receipt", id: requested.deletionReceiptId }))?.status).toBe(mode === "absent" ? "failed_known" : "outcome_unknown");
      expect(await repository.getResource({ workspaceId: actor.workspaceId, kind: "tombstone", id: "media:asset-1" })).toBeNull();
    }
  });

  it("does not claim a server-classified resource before its retention period expires", async () => {
    const repository = new InMemoryGovernanceRepository();
    const requested = await requestDeletion(repository, { durationDays: 30, createdAt: now });
    expect(requested.status).toBe("delayed");
    const remove = vi.fn();
    await new GovernanceDeletionWorker(repository, { delete: remove }, { now: () => new Date(now) }).process({ workspaceId: actor.workspaceId, deletionReceiptId: requested.deletionReceiptId });
    expect(remove).not.toHaveBeenCalled();
    expect((await repository.getResource({ workspaceId: actor.workspaceId, kind: "deletion_receipt", id: requested.deletionReceiptId }))?.status).toBe("delayed");
  });
});
