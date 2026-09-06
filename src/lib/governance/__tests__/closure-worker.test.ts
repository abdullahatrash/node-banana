import { describe, expect, it, vi } from "vitest";
import { canonicalDigest } from "@/lib/agent-tools/canonical";
import { GovernanceWorkspaceClosureWorker } from "../closure-worker";
import { InMemoryGovernanceRepository } from "../memory-repository";
import { TRUSTED_RETENTION_LEGAL_FLOORS } from "../retention-policy";
import { RETENTION_CLASSES, type GovernanceResource, type RetentionRule } from "../types";
import { generationRightsRetentionReceiptKey } from "../retention-proof";

const now = new Date("2026-09-04T12:00:00.000Z");

function resource(kind: GovernanceResource["kind"], id: string, status: string, body: Record<string, unknown>): GovernanceResource {
  return { id, workspaceId: "workspace-a", kind, version: 1, status, body, createdByUserId: "owner-a", createdAt: now, updatedAt: now };
}

async function seed(repository: InMemoryGovernanceRepository, withPolicy = true) {
  const rules: RetentionRule[] = RETENTION_CLASSES.map((retentionClass) => ({ retentionClass, durationDays: TRUSTED_RETENTION_LEGAL_FLOORS[retentionClass], recoverableDays: 0, legalFloorDays: TRUSTED_RETENTION_LEGAL_FLOORS[retentionClass] }));
  const mutations = [
    { type: "create" as const, expectedVersion: null, resource: resource("workspace_closure", "closure-a", "erasure_queued", { requestedByUserId: "owner-a", executeAfter: now.toISOString(), executedAt: now.toISOString(), exportId: "export-a", erasureCursor: null, erasureScheduled: false, accessRevocationEvidence: null, completionEvidence: null, lease: null, leaseFence: 0 }) },
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

async function recordRightsDecision(repository: InMemoryGovernanceRepository, input: { closureId: string; closureLease: { id: string; fence: number } }, holdIds: string[], retentionRevision: unknown, decisionDigest: string) {
  await repository.commit({
    receipt: {
      workspaceId: "workspace-a",
      capability: "workspace_closures.erase_generation_rights_attempt@1",
      idempotencyKey: generationRightsRetentionReceiptKey(input.closureId, input.closureLease.id, input.closureLease.fence),
      requestDigest: decisionDigest,
      result: { schema: "generation-rights-retention-decision-result/v1", closureId: input.closureId, leaseId: input.closureLease.id, leaseFence: input.closureLease.fence, decisionDigest, blockingHoldIds: holdIds, retentionPolicyRevision: 1, retentionRevisionDigest: `sha256:${"9".repeat(64)}` },
      createdAt: now,
    },
    mutations: [],
    audit: { schema: "workspace-audit-event/v1", id: `audit-decision-${input.closureLease.fence}`, workspaceId: "workspace-a", actor: { kind: "system", id: null }, capability: "workspace_closures.retain_generation_rights@1", action: "retain", resource: null, outcome: "accepted", redactedDetails: {}, occurredAt: now },
  });
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

  it("persists and increments the lease fence across release and reclaim", async () => {
    const repository = new InMemoryGovernanceRepository();
    await seed(repository);
    const unknownRevocation = { ...revocation(), externalEffects: [{ kind: "provider_credential_revoke" as const, targetId: "credential-a", idempotencyKey: "closure:credential-a", attempts: 1, attemptedAt: now.toISOString(), state: "outcome_unknown" as const, reason: "timeout" }] };
    const adapter = { revokeAccess: vi.fn(async () => unknownRevocation), listRetentionResources: vi.fn(), hardEraseWorkspace: vi.fn() };
    const worker = new GovernanceWorkspaceClosureWorker(repository, adapter, { now: () => now });
    await worker.process({ workspaceId: "workspace-a", closureId: "closure-a" });
    expect(await repository.getResource({ workspaceId: "workspace-a", kind: "workspace_closure", id: "closure-a" })).toMatchObject({ status: "waiting_erasure", body: { lease: null, leaseFence: 1 } });
    await worker.process({ workspaceId: "workspace-a", closureId: "closure-a" });
    expect(await repository.getResource({ workspaceId: "workspace-a", kind: "workspace_closure", id: "closure-a" })).toMatchObject({ status: "waiting_erasure", body: { lease: null, leaseFence: 2 } });
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

  it("accepts an ordinary retained surface bound to the union of multiple retained-resource holds", async () => {
    const repository = new InMemoryGovernanceRepository();
    await seed(repository);
    const adapter = {
      revokeAccess: vi.fn(async () => revocation()),
      listRetentionResources: vi.fn(async () => ({
        items: [
          { cursor: "asset:asset-a", descriptor: { resourceKind: "media", resourceId: "asset-a", retentionClass: "workspace_media" as const, createdAt: now, authoritativeSystems: ["primary"] } },
          { cursor: "asset:asset-b", descriptor: { resourceKind: "media", resourceId: "asset-b", retentionClass: "workspace_media" as const, createdAt: now, authoritativeSystems: ["primary"] } },
        ],
        nextCursor: null,
      })),
      hardEraseWorkspace: vi.fn(async () => ({
        ...hardErasure(),
        effects: [{ kind: "workspace_hard_erasure" as const, targetId: "media", idempotencyKey: "closure:media", attempts: 1, attemptedAt: now.toISOString(), state: "retained" as const, evidenceRef: "primary:held:media", legalHoldEvidence: { holdIds: ["hold-a", "hold-b"], policyRevision: 1, evidenceRef: "legal-hold:media-union" } }],
        surfaces: ["media"],
        retainedResources: [
          { resourceKind: "media", resourceId: "asset-a", holdIds: ["hold-a"] },
          { resourceKind: "media", resourceId: "asset-b", holdIds: ["hold-b"] },
        ],
      })),
    };
    const worker = new GovernanceWorkspaceClosureWorker(repository, adapter, { now: () => now });
    await worker.process({ workspaceId: "workspace-a", closureId: "closure-a" });
    const receipts = await repository.listResources<{ resourceId: string }>({ workspaceId: "workspace-a", kinds: ["deletion_receipt"] });
    for (const [index, receipt] of receipts.entries()) {
      const holdId = receipt.body.resourceId === "asset-a" ? "hold-a" : "hold-b";
      await repository.commit({
        receipt: { workspaceId: "workspace-a", capability: "test.hold_receipt@1", idempotencyKey: `hold-receipt-${index}`, requestDigest: canonicalDigest({ holdId }), result: {}, createdAt: now },
        mutations: [{ type: "update", expectedVersion: receipt.version, resource: { ...receipt, version: receipt.version + 1, status: "completed_hold", body: { ...receipt.body, holdIds: [holdId] }, updatedAt: now } }],
        audit: { schema: "workspace-audit-event/v1", id: `audit-hold-receipt-${index}`, workspaceId: "workspace-a", actor: { kind: "system", id: null }, capability: "test.hold_receipt@1", action: "hold_receipt", resource: { kind: "deletion_receipt", id: receipt.id }, outcome: "completed", redactedDetails: {}, occurredAt: now },
      });
    }
    await worker.process({ workspaceId: "workspace-a", closureId: "closure-a" });
    expect(await repository.getResource({ workspaceId: "workspace-a", kind: "workspace_closure", id: "closure-a" })).toMatchObject({ status: "closed_retained", body: { completionEvidence: { holds: ["hold-a", "hold-b"] } } });
  });

  it("refuses retained surface proof bound to a stale retention policy revision", async () => {
    const repository = new InMemoryGovernanceRepository();
    await seed(repository);
    await repository.commit({
      receipt: { workspaceId: "workspace-a", capability: "test.seed_hold@1", idempotencyKey: "seed-stale-proof-hold", requestDigest: canonicalDigest({ holdId: "hold-a" }), result: {}, createdAt: now },
      mutations: [{ type: "create", expectedVersion: null, resource: resource("retention_hold", "hold-a", "active", { retentionClasses: ["workspace_media"], expiresAt: null }) }],
      audit: { schema: "workspace-audit-event/v1", id: "audit-stale-proof-hold", workspaceId: "workspace-a", actor: { kind: "system", id: null }, capability: "test.seed_hold@1", action: "seed_hold", resource: { kind: "retention_hold", id: "hold-a" }, outcome: "completed", redactedDetails: {}, occurredAt: now },
    });
    const adapter = {
      revokeAccess: vi.fn(async () => revocation()),
      listRetentionResources: vi.fn(async () => ({ items: [{ cursor: "asset:asset-a", descriptor: { resourceKind: "media", resourceId: "asset-a", retentionClass: "workspace_media" as const, createdAt: now, authoritativeSystems: ["primary"] } }], nextCursor: null })),
      hardEraseWorkspace: vi.fn(async () => ({
        ...hardErasure(),
        effects: [{ kind: "workspace_hard_erasure" as const, targetId: "media", idempotencyKey: "closure:media", attempts: 1, attemptedAt: now.toISOString(), state: "retained" as const, evidenceRef: "primary:held:media", legalHoldEvidence: { holdIds: ["hold-a"], policyRevision: 2, evidenceRef: "legal-hold:stale" } }],
        retainedResources: [{ resourceKind: "media", resourceId: "asset-a", holdIds: ["hold-a"] }],
      })),
    };
    const worker = new GovernanceWorkspaceClosureWorker(repository, adapter, { now: () => now });
    await worker.process({ workspaceId: "workspace-a", closureId: "closure-a" });
    await worker.process({ workspaceId: "workspace-a", closureId: "closure-a" });
    expect((await repository.getResource({ workspaceId: "workspace-a", kind: "workspace_closure", id: "closure-a" }))?.status).toBe("waiting_erasure");
    expect(await repository.getResource({ workspaceId: "workspace-a", kind: "tombstone", id: "workspace:workspace-a" })).toBeNull();
  });

  it("waits quietly when an indefinite rights hold exists even if its original class has no enumerated rows", async () => {
    const repository = new InMemoryGovernanceRepository();
    await seed(repository);
    await repository.commit({
      receipt: { workspaceId: "workspace-a", capability: "test.seed_hold@1", idempotencyKey: "seed-rights-only-hold", requestDigest: canonicalDigest({ holdId: "hold-rights" }), result: {}, createdAt: now },
      mutations: [{ type: "create", expectedVersion: null, resource: resource("retention_hold", "hold-rights", "active", { retentionClasses: ["security_evidence", "generation_rights_evidence"], expiresAt: null }) }],
      audit: { schema: "workspace-audit-event/v1", id: "audit-seed-rights-hold", workspaceId: "workspace-a", actor: { kind: "system", id: null }, capability: "test.seed_hold@1", action: "seed_hold", resource: { kind: "retention_hold", id: "hold-rights" }, outcome: "completed", redactedDetails: {}, occurredAt: now },
    });
    const adapter = {
      revokeAccess: vi.fn(async () => revocation()),
      listRetentionResources: vi.fn(async () => ({ items: [], nextCursor: null })),
      hardEraseWorkspace: vi.fn(async (input: { closureId: string; closureLease: { id: string; fence: number }; retainedResources: Array<{ resourceKind: string; resourceId: string; holdIds: string[] }> }) => {
        const retentionRevision = { revision: 1, rules: RETENTION_CLASSES.map((retentionClass) => ({ retentionClass, durationDays: TRUSTED_RETENTION_LEGAL_FLOORS[retentionClass], recoverableDays: 0, legalFloorDays: TRUSTED_RETENTION_LEGAL_FLOORS[retentionClass] })) };
        const decisionDigest = `sha256:${"d".repeat(64)}`;
        await recordRightsDecision(repository, input, ["hold-rights"], retentionRevision, decisionDigest);
        return { schema: "workspace-hard-erasure-evidence/v1" as const, effects: [{ kind: "workspace_hard_erasure" as const, targetId: "inspiration_rights_evidence_and_snapshots", idempotencyKey: "closure:rights", attempts: 1, attemptedAt: now.toISOString(), state: "retained" as const, reason: "GENERATION_RIGHTS_LEGALLY_RETAINED", evidenceRef: "rights:held", legalHoldEvidence: { holdIds: ["hold-rights"], policyRevision: 1, policyRevisionDigest: canonicalDigest(retentionRevision), policyRevisionRecordDigest: `sha256:${"9".repeat(64)}`, evidenceRef: decisionDigest } }], surfaces: ["inspiration_rights_evidence_and_snapshots"], omissions: [], retainedResources: [...input.retainedResources, { resourceKind: "generation_rights_evidence", resourceId: "workspace:workspace-a", holdIds: ["hold-rights"] }], evidenceRef: "sha256:rights-held" };
      }),
    };
    const worker = new GovernanceWorkspaceClosureWorker(repository, adapter, { now: () => now });
    await worker.process({ workspaceId: "workspace-a", closureId: "closure-a" });
    await worker.process({ workspaceId: "workspace-a", closureId: "closure-a" });
    expect(adapter.hardEraseWorkspace).toHaveBeenCalledWith(expect.objectContaining({ retainedResources: [] }));
    expect(await repository.getResource({ workspaceId: "workspace-a", kind: "workspace_closure", id: "closure-a" })).toMatchObject({ status: "waiting_erasure", body: { generationRightsHoldWait: { holdIds: ["hold-rights"], retryAt: null }, nextErasureAttemptAt: null } });
    expect((await repository.listClaimableGovernanceJobs({ evaluatedAt: new Date(now.getTime() + 365 * 86_400_000), limit: 10 })).some((item) => item.id === "closure-a")).toBe(false);
    const attempts = adapter.hardEraseWorkspace.mock.calls.length;
    await worker.process({ workspaceId: "workspace-a", closureId: "closure-a" });
    expect(adapter.hardEraseWorkspace).toHaveBeenCalledTimes(attempts);
  });

  it("rejects a stale hold wait when release races the signed decision commit, then erases", async () => {
    const repository = new InMemoryGovernanceRepository();
    await seed(repository);
    const hold = resource("retention_hold", "hold-rights", "active", { retentionClasses: ["generation_rights_evidence"], expiresAt: null });
    await repository.commit({
      receipt: { workspaceId: "workspace-a", capability: "test.seed_hold@1", idempotencyKey: "seed-racing-hold", requestDigest: canonicalDigest({}), result: {}, createdAt: now },
      mutations: [{ type: "create", expectedVersion: null, resource: hold }],
      audit: { schema: "workspace-audit-event/v1", id: "audit-racing-hold", workspaceId: "workspace-a", actor: { kind: "system", id: null }, capability: "test.seed_hold@1", action: "seed", resource: null, outcome: "completed", redactedDetails: {}, occurredAt: now },
    });
    const rules = RETENTION_CLASSES.map((retentionClass) => ({ retentionClass, durationDays: TRUSTED_RETENTION_LEGAL_FLOORS[retentionClass], recoverableDays: 0, legalFloorDays: TRUSTED_RETENTION_LEGAL_FLOORS[retentionClass] }));
    let erasureCalls = 0;
    const adapter = {
      revokeAccess: vi.fn(async () => revocation()),
      listRetentionResources: vi.fn(async () => ({ items: [], nextCursor: null })),
      hardEraseWorkspace: vi.fn(async (input: { closureId: string; closureLease: { id: string; fence: number } }) => {
        erasureCalls += 1;
        if (erasureCalls > 1) return hardErasure();
        const retentionRevision = { revision: 1, rules };
        const decisionDigest = `sha256:${"e".repeat(64)}`;
        await recordRightsDecision(repository, input, ["hold-rights"], retentionRevision, decisionDigest);
        await repository.commit({
          receipt: { workspaceId: "workspace-a", capability: "test.release_hold@1", idempotencyKey: "release-racing-hold", requestDigest: canonicalDigest({}), result: {}, createdAt: now },
          mutations: [{ type: "update", expectedVersion: 1, resource: { ...hold, version: 2, status: "released", updatedAt: now } }],
          audit: { schema: "workspace-audit-event/v1", id: "audit-release-racing-hold", workspaceId: "workspace-a", actor: { kind: "system", id: null }, capability: "test.release_hold@1", action: "release", resource: null, outcome: "completed", redactedDetails: {}, occurredAt: now },
        });
        return { schema: "workspace-hard-erasure-evidence/v1" as const, effects: [{ kind: "workspace_hard_erasure" as const, targetId: "inspiration_rights_evidence_and_snapshots", idempotencyKey: "closure:rights", attempts: 1, attemptedAt: now.toISOString(), state: "retained" as const, reason: "GENERATION_RIGHTS_LEGALLY_RETAINED", evidenceRef: "rights:held", legalHoldEvidence: { holdIds: ["hold-rights"], policyRevision: 1, policyRevisionDigest: canonicalDigest(retentionRevision), policyRevisionRecordDigest: `sha256:${"9".repeat(64)}`, evidenceRef: decisionDigest } }], surfaces: ["inspiration_rights_evidence_and_snapshots"], omissions: [], retainedResources: [{ resourceKind: "generation_rights_evidence", resourceId: "workspace:workspace-a", holdIds: ["hold-rights"] }], evidenceRef: "sha256:rights-held" };
      }),
    };
    const worker = new GovernanceWorkspaceClosureWorker(repository, adapter, { now: () => now });
    await worker.process({ workspaceId: "workspace-a", closureId: "closure-a" });
    await worker.process({ workspaceId: "workspace-a", closureId: "closure-a" });
    expect(await repository.getResource({ workspaceId: "workspace-a", kind: "workspace_closure", id: "closure-a" })).toMatchObject({ status: "waiting_erasure", body: { generationRightsHoldWait: null, nextErasureAttemptAt: null } });
    await worker.process({ workspaceId: "workspace-a", closureId: "closure-a" });
    expect(erasureCalls).toBe(2);
    expect(await repository.getResource({ workspaceId: "workspace-a", kind: "workspace_closure", id: "closure-a" })).toMatchObject({ status: "closed" });
    expect(await repository.getResource({ workspaceId: "workspace-a", kind: "tombstone", id: "workspace:workspace-a" })).not.toBeNull();
  });

  it("rejects a same-number retention policy rewrite during final rights-hold validation", async () => {
    const repository = new InMemoryGovernanceRepository();
    await seed(repository);
    const original = await repository.getResource<{ revisions: unknown[]; activeRevision: number }>({ workspaceId: "workspace-a", kind: "retention_policy", id: "active" });
    expect(original).not.toBeNull();
    const revision = original!.body.revisions[0]!;
    await repository.commit({
      receipt: { workspaceId: "workspace-a", capability: "test.rewrite_policy@1", idempotencyKey: "rewrite-policy", requestDigest: canonicalDigest({}), result: {}, createdAt: now },
      mutations: [{ type: "update", expectedVersion: original!.version, resource: { ...original!, version: original!.version + 1, body: { ...original!.body, revisions: [{ ...(revision as Record<string, unknown>), createdAt: "2026-09-04T12:00:01.000Z" }] } } }],
      audit: { schema: "workspace-audit-event/v1", id: "audit-rewrite-policy", workspaceId: "workspace-a", actor: { kind: "system", id: null }, capability: "test.rewrite_policy@1", action: "rewrite", resource: null, outcome: "completed", redactedDetails: {}, occurredAt: now },
    });
    const outcome = await repository.commit({
      receipt: { workspaceId: "workspace-a", capability: "test.complete@1", idempotencyKey: "validate-old-policy", requestDigest: canonicalDigest({}), result: {}, createdAt: now },
      mutations: [],
      generationRightsRetentionValidation: { closureId: "closure-a", leaseId: "lease_fixture", leaseFence: 1, decisionDigest: `sha256:${"f".repeat(64)}`, decisionRevisionDigest: `sha256:${"9".repeat(64)}`, activePolicyRevision: 1, activeRevisionDigest: canonicalDigest(revision), activeHoldIds: [], evaluatedAt: now },
      audit: { schema: "workspace-audit-event/v1", id: "audit-validate-old-policy", workspaceId: "workspace-a", actor: { kind: "system", id: null }, capability: "test.complete@1", action: "validate", resource: null, outcome: "completed", redactedDetails: {}, occurredAt: now },
    });
    expect(outcome).toEqual({ type: "conflict" });
  });

  it("does not reclaim a retention-period block until its exact eligible time", async () => {
    const repository = new InMemoryGovernanceRepository();
    await seed(repository);
    let current = new Date(now);
    const eligibleAt = new Date(now.getTime() + 86_400_000);
    const blocked = { ...hardErasure(), effects: hardErasure().effects.map((effect) => ({ ...effect, state: "failed_known" as const, evidenceRef: undefined, reason: "GENERATION_RIGHTS_PREFLIGHT_blocked_retention_period" })), retryAt: eligibleAt.toISOString() };
    const adapter = { revokeAccess: vi.fn(async () => revocation()), listRetentionResources: vi.fn(async () => ({ items: [], nextCursor: null })), hardEraseWorkspace: vi.fn(async () => blocked) };
    const worker = new GovernanceWorkspaceClosureWorker(repository, adapter, { now: () => current });
    await worker.process({ workspaceId: "workspace-a", closureId: "closure-a" });
    await worker.process({ workspaceId: "workspace-a", closureId: "closure-a" });
    expect(await repository.getResource({ workspaceId: "workspace-a", kind: "workspace_closure", id: "closure-a" })).toMatchObject({ status: "waiting_erasure", body: { leaseFence: 2, nextErasureAttemptAt: eligibleAt.toISOString() } });
    const calls = adapter.revokeAccess.mock.calls.length;
    await worker.process({ workspaceId: "workspace-a", closureId: "closure-a" });
    expect(adapter.revokeAccess).toHaveBeenCalledTimes(calls);
    expect((await repository.listClaimableGovernanceJobs({ evaluatedAt: new Date(eligibleAt.getTime() - 1), limit: 10 })).some((item) => item.id === "closure-a")).toBe(false);
    current = eligibleAt;
    await worker.process({ workspaceId: "workspace-a", closureId: "closure-a" });
    expect(adapter.revokeAccess).toHaveBeenCalledTimes(calls + 1);
    expect(await repository.getResource({ workspaceId: "workspace-a", kind: "workspace_closure", id: "closure-a" })).toMatchObject({ body: { leaseFence: 3 } });
  });

  it("rechecks a finite rights hold only at expiry and then completes erasure", async () => {
    const repository = new InMemoryGovernanceRepository();
    await seed(repository);
    let current = new Date(now);
    const eligibleAt = new Date(now.getTime() + 86_400_000);
    const hold = resource("retention_hold", "hold-rights", "active", { retentionClasses: ["generation_rights_evidence"], expiresAt: eligibleAt.toISOString() });
    await repository.commit({
      receipt: { workspaceId: "workspace-a", capability: "test.seed_hold@1", idempotencyKey: "seed-finite-rights-hold", requestDigest: canonicalDigest({}), result: {}, createdAt: now },
      mutations: [{ type: "create", expectedVersion: null, resource: hold }],
      audit: { schema: "workspace-audit-event/v1", id: "audit-finite-rights-hold", workspaceId: "workspace-a", actor: { kind: "system", id: null }, capability: "test.seed_hold@1", action: "seed", resource: null, outcome: "completed", redactedDetails: {}, occurredAt: now },
    });
    let erasureCalls = 0;
    const retentionRevision = { revision: 1, rules: RETENTION_CLASSES.map((retentionClass) => ({ retentionClass, durationDays: TRUSTED_RETENTION_LEGAL_FLOORS[retentionClass], recoverableDays: 0, legalFloorDays: TRUSTED_RETENTION_LEGAL_FLOORS[retentionClass] })) };
    const adapter = {
      revokeAccess: vi.fn(async () => revocation()),
      listRetentionResources: vi.fn(async () => ({ items: [], nextCursor: null })),
      hardEraseWorkspace: vi.fn(async (input: { closureId: string; closureLease: { id: string; fence: number } }) => {
        erasureCalls += 1;
        if (erasureCalls > 1) return hardErasure();
        await recordRightsDecision(repository, input, ["hold-rights"], retentionRevision, `sha256:${"d".repeat(64)}`);
        return {
          schema: "workspace-hard-erasure-evidence/v1" as const,
          effects: [{ kind: "workspace_hard_erasure" as const, targetId: "inspiration_rights_evidence_and_snapshots", idempotencyKey: "closure:rights", attempts: 1, attemptedAt: current.toISOString(), state: "retained" as const, reason: "GENERATION_RIGHTS_LEGALLY_RETAINED", evidenceRef: "rights:held", legalHoldEvidence: { holdIds: ["hold-rights"], policyRevision: 1, policyRevisionDigest: canonicalDigest(retentionRevision), policyRevisionRecordDigest: `sha256:${"9".repeat(64)}`, evidenceRef: `sha256:${"d".repeat(64)}` } }],
          surfaces: ["inspiration_rights_evidence_and_snapshots"], omissions: [], retainedResources: [{ resourceKind: "generation_rights_evidence", resourceId: "workspace:workspace-a", holdIds: ["hold-rights"] }], retryAt: eligibleAt.toISOString(), evidenceRef: "sha256:rights-held",
        };
      }),
    };
    const worker = new GovernanceWorkspaceClosureWorker(repository, adapter, { now: () => current });
    await worker.process({ workspaceId: "workspace-a", closureId: "closure-a" });
    await worker.process({ workspaceId: "workspace-a", closureId: "closure-a" });
    expect(await repository.getResource({ workspaceId: "workspace-a", kind: "workspace_closure", id: "closure-a" })).toMatchObject({ status: "waiting_erasure", body: { nextErasureAttemptAt: eligibleAt.toISOString(), generationRightsHoldWait: { retryAt: eligibleAt.toISOString() } } });
    const auditCount = repository.audit.length;
    await worker.process({ workspaceId: "workspace-a", closureId: "closure-a" });
    expect(erasureCalls).toBe(1);
    expect(repository.audit).toHaveLength(auditCount);
    current = eligibleAt;
    await worker.process({ workspaceId: "workspace-a", closureId: "closure-a" });
    expect(erasureCalls).toBe(2);
    expect(await repository.getResource({ workspaceId: "workspace-a", kind: "workspace_closure", id: "closure-a" })).toMatchObject({ status: "closed" });
  });

  it("rejects a retained rights effect that omits its exact rights descriptor", async () => {
    const repository = new InMemoryGovernanceRepository();
    await seed(repository);
    const adapter = {
      revokeAccess: vi.fn(async () => revocation()),
      listRetentionResources: vi.fn(async () => ({ items: [], nextCursor: null })),
      hardEraseWorkspace: vi.fn(async () => ({
        schema: "workspace-hard-erasure-evidence/v1" as const,
        effects: [{ kind: "workspace_hard_erasure" as const, targetId: "inspiration_rights_evidence_and_snapshots", idempotencyKey: "closure:rights", attempts: 1, attemptedAt: now.toISOString(), state: "retained" as const, reason: "GENERATION_RIGHTS_LEGALLY_RETAINED", evidenceRef: "rights:held", legalHoldEvidence: { holdIds: ["unrelated-hold"], policyRevision: 1, policyRevisionDigest: `sha256:${"a".repeat(64)}`, evidenceRef: "rights:decision" } }],
        surfaces: ["inspiration_rights_evidence_and_snapshots"], omissions: [], retainedResources: [{ resourceKind: "media", resourceId: "asset-a", holdIds: ["unrelated-hold"] }], evidenceRef: "sha256:invalid",
      })),
    };
    const worker = new GovernanceWorkspaceClosureWorker(repository, adapter, { now: () => now });
    await worker.process({ workspaceId: "workspace-a", closureId: "closure-a" });
    await worker.process({ workspaceId: "workspace-a", closureId: "closure-a" });
    expect(await repository.getResource({ workspaceId: "workspace-a", kind: "workspace_closure", id: "closure-a" })).toMatchObject({ status: "waiting_erasure" });
  });
});
