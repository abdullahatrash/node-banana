import { describe, expect, it, vi } from "vitest";
import { GovernanceDeletionWorker } from "../deletion-worker";
import { InMemoryGovernanceRepository } from "../memory-repository";
import { GovernanceService } from "../service";

const now = new Date("2026-09-03T12:00:00.000Z");
const actor = { workspaceId: "workspace-1", userId: "owner-1", legacyRole: "owner" as const, authContextId: "session-owner-1" };

async function requestDeletion(repository: InMemoryGovernanceRepository) {
  const service = new GovernanceService(repository, { now: () => now });
  const challenge = await service.execute(actor, { type: "begin_step_up", purpose: "retention.delete", resourceId: "asset-1" }, "begin-delete") as { challengeId: string; verificationCode: string };
  const session = await service.execute(actor, { type: "verify_step_up", challengeId: challenge.challengeId, code: challenge.verificationCode }, "verify-delete") as { stepUpToken: string };
  return service.execute(actor, { type: "record_deletion", resourceKind: "media", resourceId: "asset-1", retentionClass: "workspace_media", systems: ["primary", "replica"], stepUpToken: session.stepUpToken }, "request-delete") as Promise<{ deletionReceiptId: string; status: string; tombstoneId: null }>;
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
});
