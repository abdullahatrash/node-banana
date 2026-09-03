import { describe, expect, it, vi } from "vitest";
import { canonicalDigest } from "@/lib/agent-tools/canonical";
import { GovernanceWorkspaceClosureWorker } from "../closure-worker";
import { InMemoryGovernanceRepository } from "../memory-repository";
import { TRUSTED_RETENTION_LEGAL_FLOORS } from "../retention-policy";
import { RETENTION_CLASSES, type GovernanceResource, type RetentionRule } from "../types";

const now = new Date("2026-09-04T12:00:00.000Z");

function resource(kind: GovernanceResource["kind"], id: string, status: string, body: Record<string, unknown>): GovernanceResource {
  return { id, workspaceId: "workspace-a", kind, version: 1, status, body, createdByUserId: "owner-a", createdAt: now, updatedAt: now };
}

async function seed(repository: InMemoryGovernanceRepository, withPolicy = true) {
  const rules: RetentionRule[] = RETENTION_CLASSES.map((retentionClass) => ({ retentionClass, durationDays: TRUSTED_RETENTION_LEGAL_FLOORS[retentionClass], recoverableDays: 0, legalFloorDays: TRUSTED_RETENTION_LEGAL_FLOORS[retentionClass] }));
  const mutations = [
    { type: "create" as const, expectedVersion: null, resource: resource("workspace_closure", "closure-a", "erasure_queued", { requestedByUserId: "owner-a", executeAfter: now.toISOString(), executedAt: now.toISOString(), exportId: "export-a", erasureCursor: null, erasureScheduled: false, accessRevocationEvidence: null, completionEvidence: null, lease: null }) },
    { type: "create" as const, expectedVersion: null, resource: resource("workspace_export", "export-a", "succeeded", { manifest: { digest: "export-digest" } }) },
  ];
  if (withPolicy) mutations.push({ type: "create", expectedVersion: null, resource: resource("retention_policy", "active", "active", { revisions: [{ revision: 1, rules }], activeRevision: 1 }) });
  await repository.commit({ receipt: { workspaceId: "workspace-a", capability: "test.seed@1", idempotencyKey: `seed-${withPolicy}`, requestDigest: canonicalDigest({ withPolicy }), result: {}, createdAt: now }, mutations, audit: { schema: "workspace-audit-event/v1", id: `audit-seed-${withPolicy}`, workspaceId: "workspace-a", actor: { kind: "system", id: null }, capability: "test.seed@1", action: "seed", resource: null, outcome: "completed", redactedDetails: {}, occurredAt: now } });
}

function revocation() {
  return { schema: "workspace-access-revocation-evidence/v1" as const, apiTokens: 1, agentPrincipals: 1, agentKeys: 1, credentialProfiles: 1, socialAccounts: 1, evidenceRef: "sha256:revocation" };
}

describe("GovernanceWorkspaceClosureWorker", () => {
  it("schedules server-resolved deletion receipts under the active trusted policy", async () => {
    const repository = new InMemoryGovernanceRepository();
    await seed(repository);
    const adapter = {
      revokeAccess: vi.fn(async () => revocation()),
      listRetentionResources: vi.fn(async () => ({ items: [{ cursor: "asset:asset-a", descriptor: { resourceKind: "media", resourceId: "asset-a", retentionClass: "workspace_media" as const, createdAt: now, authoritativeSystems: ["primary", "backup"] } }], nextCursor: null })),
    };
    await new GovernanceWorkspaceClosureWorker(repository, adapter, { now: () => now }).process({ workspaceId: "workspace-a", closureId: "closure-a" });
    expect(adapter.revokeAccess).toHaveBeenCalledWith({ workspaceId: "workspace-a", idempotencyKey: "workspace-closure:closure-a:access", evaluatedAt: now });
    const closure = await repository.getResource({ workspaceId: "workspace-a", kind: "workspace_closure", id: "closure-a" });
    expect(closure).toMatchObject({ status: "waiting_erasure", body: { erasureScheduled: true, accessRevocationEvidence: { evidenceRef: "sha256:revocation" } } });
    const receipts = await repository.listResources<{ resourceKind: string; resourceId: string; systems: string[] }>({ workspaceId: "workspace-a", kinds: ["deletion_receipt"] });
    expect(receipts).toHaveLength(1);
    expect(receipts[0]).toMatchObject({ status: "queued", body: { resourceKind: "media", resourceId: "asset-a", systems: ["backup", "primary"] } });
  });

  it("closes and tombstones only after export and all erasure scheduling complete", async () => {
    const repository = new InMemoryGovernanceRepository();
    await seed(repository);
    const adapter = { revokeAccess: vi.fn(async () => revocation()), listRetentionResources: vi.fn(async () => ({ items: [], nextCursor: null })) };
    const worker = new GovernanceWorkspaceClosureWorker(repository, adapter, { now: () => now });
    await worker.process({ workspaceId: "workspace-a", closureId: "closure-a" });
    expect((await repository.getResource({ workspaceId: "workspace-a", kind: "workspace_closure", id: "closure-a" }))?.status).toBe("waiting_erasure");
    await worker.process({ workspaceId: "workspace-a", closureId: "closure-a" });
    const closure = await repository.getResource({ workspaceId: "workspace-a", kind: "workspace_closure", id: "closure-a" });
    expect(closure).toMatchObject({ status: "closed", body: { completionEvidence: { schema: "workspace-closure-completion-evidence/v1", exportId: "export-a" } } });
    expect(await repository.getResource({ workspaceId: "workspace-a", kind: "tombstone", id: "workspace:workspace-a" })).toMatchObject({ status: "active" });
    expect(repository.canonicalEffects).toContainEqual(expect.objectContaining({ type: "workspace_close", workspaceId: "workspace-a", currentOwnerUserId: "owner-a" }));
  });

  it("stays write-blocked and waits when no deployment-trusted retention policy is active", async () => {
    const repository = new InMemoryGovernanceRepository();
    await seed(repository, false);
    const adapter = { revokeAccess: vi.fn(async () => revocation()), listRetentionResources: vi.fn() };
    await new GovernanceWorkspaceClosureWorker(repository, adapter, { now: () => now }).process({ workspaceId: "workspace-a", closureId: "closure-a" });
    expect((await repository.getResource({ workspaceId: "workspace-a", kind: "workspace_closure", id: "closure-a" }))?.status).toBe("waiting_retention_policy");
    expect(adapter.listRetentionResources).not.toHaveBeenCalled();
    expect(repository.canonicalEffects).toHaveLength(0);
  });
});
