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
  return { schema: "workspace-access-revocation-evidence/v1" as const, apiTokens: 1, agentPrincipals: 1, agentKeys: 1, credentialProfiles: 1, socialAccounts: 1, externalEffects: [{ kind: "social_disconnect" as const, targetId: "social-a", idempotencyKey: "closure:social-a", attempts: 1, attemptedAt: now.toISOString(), state: "deleted" as const, evidenceRef: "provider:disconnect:a" }], evidenceRef: "sha256:revocation" };
}

function hardErasure() {
  return { schema: "workspace-hard-erasure-evidence/v1" as const, effects: ["media", "content"].map((targetId) => ({ kind: "workspace_hard_erasure" as const, targetId, idempotencyKey: `closure:${targetId}`, attempts: 1, attemptedAt: now.toISOString(), state: "deleted" as const, evidenceRef: `primary:erased:${targetId}` })), surfaces: ["media", "content"], omissions: [], retainedResources: [], evidenceRef: "sha256:erasure" };
}

describe("GovernanceWorkspaceClosureWorker", () => {
  it("schedules server-resolved deletion receipts under the active trusted policy", async () => {
    const repository = new InMemoryGovernanceRepository();
    await seed(repository);
    const adapter = {
      revokeAccess: vi.fn(async () => revocation()),
      listRetentionResources: vi.fn(async () => ({ items: [{ cursor: "asset:asset-a", descriptor: { resourceKind: "media", resourceId: "asset-a", retentionClass: "workspace_media" as const, createdAt: now, authoritativeSystems: ["primary", "backup"] } }], nextCursor: null })),
      hardEraseWorkspace: vi.fn(async () => hardErasure()),
    };
    await new GovernanceWorkspaceClosureWorker(repository, adapter, { now: () => now }).process({ workspaceId: "workspace-a", closureId: "closure-a" });
    expect(adapter.revokeAccess).toHaveBeenCalledWith({ workspaceId: "workspace-a", idempotencyKey: "workspace-closure:closure-a:access", evaluatedAt: now });
    const closure = await repository.getResource({ workspaceId: "workspace-a", kind: "workspace_closure", id: "closure-a" });
    expect(closure).toMatchObject({ status: "waiting_erasure", body: { erasureScheduled: true, accessRevocationEvidence: { evidenceRef: expect.stringMatching(/^sha256:/) } } });
    const receipts = await repository.listResources<{ resourceKind: string; resourceId: string; systems: string[] }>({ workspaceId: "workspace-a", kinds: ["deletion_receipt"] });
    expect(receipts).toHaveLength(1);
    expect(receipts[0]).toMatchObject({ status: "queued", body: { resourceKind: "media", resourceId: "asset-a", systems: ["backup", "primary"] } });
  });

  it("closes and tombstones only after export and all erasure scheduling complete", async () => {
    const repository = new InMemoryGovernanceRepository();
    await seed(repository);
    const adapter = { revokeAccess: vi.fn(async () => revocation()), listRetentionResources: vi.fn(async () => ({ items: [], nextCursor: null })), hardEraseWorkspace: vi.fn(async () => hardErasure()) };
    const worker = new GovernanceWorkspaceClosureWorker(repository, adapter, { now: () => now });
    await worker.process({ workspaceId: "workspace-a", closureId: "closure-a" });
    expect((await repository.getResource({ workspaceId: "workspace-a", kind: "workspace_closure", id: "closure-a" }))?.status).toBe("waiting_erasure");
    await worker.process({ workspaceId: "workspace-a", closureId: "closure-a" });
    const closure = await repository.getResource({ workspaceId: "workspace-a", kind: "workspace_closure", id: "closure-a" });
    expect(closure).toMatchObject({ status: "closed", body: { completionEvidence: { schema: "workspace-closure-completion-evidence/v2", exportId: "export-a", hardErasureEvidence: { evidenceRef: expect.stringMatching(/^sha256:/) }, holds: [], unknowns: [] } } });
    expect(await repository.getResource({ workspaceId: "workspace-a", kind: "tombstone", id: "workspace:workspace-a" })).toMatchObject({ status: "active" });
    expect(repository.canonicalEffects).toContainEqual(expect.objectContaining({ type: "workspace_close", workspaceId: "workspace-a", currentOwnerUserId: "owner-a" }));
  });

  it("stays write-blocked and waits when no deployment-trusted retention policy is active", async () => {
    const repository = new InMemoryGovernanceRepository();
    await seed(repository, false);
    const adapter = { revokeAccess: vi.fn(async () => revocation()), listRetentionResources: vi.fn(), hardEraseWorkspace: vi.fn() };
    await new GovernanceWorkspaceClosureWorker(repository, adapter, { now: () => now }).process({ workspaceId: "workspace-a", closureId: "closure-a" });
    expect((await repository.getResource({ workspaceId: "workspace-a", kind: "workspace_closure", id: "closure-a" }))?.status).toBe("waiting_retention_policy");
    expect(adapter.listRetentionResources).not.toHaveBeenCalled();
    expect(repository.canonicalEffects).toHaveLength(0);
  });

  it("never closes when an external disconnect or hard-erasure outcome is unknown", async () => {
    const repository = new InMemoryGovernanceRepository();
    await seed(repository);
    const unknownRevocation = { ...revocation(), externalEffects: [{ kind: "provider_credential_revoke" as const, targetId: "credential-a", idempotencyKey: "closure:credential-a", attempts: 1, attemptedAt: now.toISOString(), state: "outcome_unknown" as const, reason: "timeout" }] };
    const adapter = { revokeAccess: vi.fn(async () => unknownRevocation), listRetentionResources: vi.fn(), hardEraseWorkspace: vi.fn() };
    const worker = new GovernanceWorkspaceClosureWorker(repository, adapter, { now: () => now });
    await worker.process({ workspaceId: "workspace-a", closureId: "closure-a" });
    await worker.process({ workspaceId: "workspace-a", closureId: "closure-a" });
    expect(await repository.getResource({ workspaceId: "workspace-a", kind: "workspace_closure", id: "closure-a" })).toMatchObject({ status: "waiting_erasure", body: { accessRevocationEvidence: { externalEffects: [{ attempts: 2, state: "outcome_unknown" }] } } });
    expect(adapter.listRetentionResources).not.toHaveBeenCalled();
    expect(repository.canonicalEffects).toHaveLength(0);
  });

  it("does not accept retained as proof that an access-bearing grant was revoked", async () => {
    const repository = new InMemoryGovernanceRepository();
    await seed(repository);
    const retainedAccess = { ...revocation(), externalEffects: [{ kind: "social_disconnect" as const, targetId: "social-a", idempotencyKey: "closure:social-a", attempts: 1, attemptedAt: now.toISOString(), state: "retained" as const, evidenceRef: "provider:record-retained" }] };
    const adapter = { revokeAccess: vi.fn(async () => retainedAccess), listRetentionResources: vi.fn(), hardEraseWorkspace: vi.fn() };
    await new GovernanceWorkspaceClosureWorker(repository, adapter, { now: () => now }).process({ workspaceId: "workspace-a", closureId: "closure-a" });
    expect((await repository.getResource({ workspaceId: "workspace-a", kind: "workspace_closure", id: "closure-a" }))?.status).toBe("waiting_erasure");
    expect(adapter.listRetentionResources).not.toHaveBeenCalled();
    expect(repository.canonicalEffects).toHaveLength(0);
  });

  it("requires terminal proof for every canonical hard-erasure surface", async () => {
    const repository = new InMemoryGovernanceRepository();
    await seed(repository);
    const adapter = {
      revokeAccess: vi.fn(async () => revocation()),
      listRetentionResources: vi.fn(async () => ({ items: [], nextCursor: null })),
      hardEraseWorkspace: vi.fn(async () => ({ ...hardErasure(), effects: [
        { kind: "workspace_hard_erasure" as const, targetId: "media", idempotencyKey: "closure:media", attempts: 1, attemptedAt: now.toISOString(), state: "deleted" as const, evidenceRef: "primary:media" },
        { kind: "workspace_hard_erasure" as const, targetId: "content", idempotencyKey: "closure:content", attempts: 1, attemptedAt: now.toISOString(), state: "outcome_unknown" as const, reason: "transport interrupted" },
      ] })),
    };
    const worker = new GovernanceWorkspaceClosureWorker(repository, adapter, { now: () => now });
    await worker.process({ workspaceId: "workspace-a", closureId: "closure-a" });
    await worker.process({ workspaceId: "workspace-a", closureId: "closure-a" });
    expect((await repository.getResource({ workspaceId: "workspace-a", kind: "workspace_closure", id: "closure-a" }))?.status).toBe("waiting_erasure");
    expect(await repository.getResource({ workspaceId: "workspace-a", kind: "tombstone", id: "workspace:workspace-a" })).toBeNull();
    expect(repository.canonicalEffects).toHaveLength(0);
  });

  it("closes as not fully erased only when retained surfaces carry exact active legal-hold proof", async () => {
    const repository = new InMemoryGovernanceRepository();
    await seed(repository);
    await repository.commit({
      receipt: { workspaceId: "workspace-a", capability: "test.seed_hold@1", idempotencyKey: "seed-hold", requestDigest: canonicalDigest({ holdId: "hold-a" }), result: {}, createdAt: now },
      mutations: [{ type: "create", expectedVersion: null, resource: resource("retention_hold", "hold-a", "active", { retentionClasses: ["workspace_media"], expiresAt: null }) }],
      audit: { schema: "workspace-audit-event/v1", id: "audit-seed-hold", workspaceId: "workspace-a", actor: { kind: "system", id: null }, capability: "test.seed_hold@1", action: "seed_hold", resource: { kind: "retention_hold", id: "hold-a" }, outcome: "completed", redactedDetails: {}, occurredAt: now },
    });
    const heldErasure = {
      ...hardErasure(),
      effects: [
        { kind: "workspace_hard_erasure" as const, targetId: "media", idempotencyKey: "closure:media", attempts: 1, attemptedAt: now.toISOString(), state: "retained" as const, evidenceRef: "primary:held:media", legalHoldEvidence: { holdIds: ["hold-a"], policyRevision: 1, evidenceRef: "legal-hold:hold-a" } },
        { kind: "workspace_hard_erasure" as const, targetId: "content", idempotencyKey: "closure:content", attempts: 1, attemptedAt: now.toISOString(), state: "deleted" as const, evidenceRef: "primary:erased:content" },
      ],
      retainedResources: [{ resourceKind: "media", resourceId: "asset-a", holdIds: ["hold-a"] }],
    };
    const adapter = {
      revokeAccess: vi.fn(async () => revocation()),
      listRetentionResources: vi.fn(async () => ({ items: [{ cursor: "asset:asset-a", descriptor: { resourceKind: "media", resourceId: "asset-a", retentionClass: "workspace_media" as const, createdAt: now, authoritativeSystems: ["primary"] } }], nextCursor: null })),
      hardEraseWorkspace: vi.fn(async () => heldErasure),
    };
    const worker = new GovernanceWorkspaceClosureWorker(repository, adapter, { now: () => now });
    await worker.process({ workspaceId: "workspace-a", closureId: "closure-a" });
    await worker.process({ workspaceId: "workspace-a", closureId: "closure-a" });
    const closure = await repository.getResource({ workspaceId: "workspace-a", kind: "workspace_closure", id: "closure-a" });
    expect(closure).toMatchObject({ status: "closed_retained", body: { completionEvidence: { fullyErased: false, holds: ["hold-a"], legalHoldEvidence: [{ surface: "media", holdIds: ["hold-a"], policyRevision: 1, evidenceRef: "legal-hold:hold-a" }] } } });
    expect(await repository.getResource({ workspaceId: "workspace-a", kind: "tombstone", id: "workspace:workspace-a" })).toMatchObject({ body: { completionEvidence: { fullyErased: false } } });
  });
});
