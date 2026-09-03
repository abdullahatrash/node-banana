import { describe, expect, it, vi } from "vitest";
import { InMemoryGovernanceRepository } from "../memory-repository";
import { GovernanceService } from "../service";
import { GovernanceExportWorker, type GovernanceExportStore } from "../export-worker";
import { canonicalDigest } from "@/lib/agent-tools/canonical";
import { HmacGovernanceImportManifestVerifier } from "../import-manifest";
import { GovernanceImportWorker } from "../import-worker";

const now = new Date("2026-09-03T12:00:00.000Z");
const actor = { workspaceId: "workspace-a", userId: "owner-a", legacyRole: "owner" as const, authContextId: "session-owner-a" };

class MemoryStore implements GovernanceExportStore {
  values = new Map<string, Uint8Array>();
  async put(input: { key: string; bytes: Uint8Array }) { this.values.set(input.key, input.bytes); }
}

async function createWorkspaceExport(repository: InMemoryGovernanceRepository, includeKinds = ["portfolio"]) {
  const service = new GovernanceService(repository, { now: () => new Date(now) });
  await service.execute(actor, { type: "create_portfolio", name: "Client portfolio" }, "portfolio-before-export");
  const challenge = await service.execute(actor, { type: "begin_step_up", purpose: "exports.manage", resourceId: null }, "begin-export-stepup") as { challengeId: string; verificationCode: string };
  const session = await service.execute(actor, { type: "verify_step_up", challengeId: challenge.challengeId, code: challenge.verificationCode }, "verify-export-stepup") as { stepUpToken: string };
  return service.execute(actor, { type: "request_workspace_export", includeKinds, stepUpToken: session.stepUpToken }, "request-workspace-export") as Promise<{ exportId: string }>;
}

describe("GovernanceExportWorker", () => {
  it("encrypts payload bytes and records a signed expiring manifest with omissions", async () => {
    const repository = new InMemoryGovernanceRepository();
    const store = new MemoryStore();
    const requested = await createWorkspaceExport(repository);
    const worker = new GovernanceExportWorker(repository, store, {
      encryptionKeyBase64: Buffer.alloc(32, 1).toString("base64"),
      signingKeyBase64: Buffer.alloc(32, 2).toString("base64"),
    }, { now: () => new Date("2026-09-03T12:01:00.000Z") });
    await worker.process({ workspaceId: actor.workspaceId, kind: "workspace_export", exportId: requested.exportId });

    const job = await repository.getResource<{ artifactRef: string; manifest: { contentDigest: string; encryptedArtifactDigest: string; omissions: string[]; signature: { value: string } } }>({ workspaceId: actor.workspaceId, kind: "workspace_export", id: requested.exportId });
    expect(job?.status).toBe("succeeded");
    expect(job?.body.manifest).toMatchObject({ contentDigest: expect.stringMatching(/^sha256:/), encryptedArtifactDigest: expect.stringMatching(/^sha256:/), omissions: expect.arrayContaining(["secrets", "credential_material"]), signature: { value: expect.stringMatching(/^[A-Za-z0-9_-]+$/) } });
    const stored = Buffer.from(store.values.get(job!.body.artifactRef)!).toString("utf8");
    expect(stored).toContain("governance-encrypted-export/v1");
    expect(stored).not.toContain("Client portfolio");
    expect((await repository.listAudit({ workspaceId: actor.workspaceId, limit: 100 })).at(-1)?.action).toBe("process_workspace_export");
  });

  it("records invalid key configuration as a durable failed-known job before storing plaintext", async () => {
    const repository = new InMemoryGovernanceRepository();
    const store = new MemoryStore();
    const requested = await createWorkspaceExport(repository);
    const worker = new GovernanceExportWorker(repository, store, { encryptionKeyBase64: "bad", signingKeyBase64: "bad" });
    await expect(worker.process({ workspaceId: actor.workspaceId, kind: "workspace_export", exportId: requested.exportId })).rejects.toThrow(/32 bytes/);
    expect((await repository.getResource({ workspaceId: actor.workspaceId, kind: "workspace_export", id: requested.exportId }))?.status).toBe("failed_known");
    expect(store.values.size).toBe(0);
  });

  it("exports every canonical portable kind and signs an import authorization for exact item digests", async () => {
    const repository = new InMemoryGovernanceRepository();
    const store = new MemoryStore();
    const kinds = ["media", "content_revision", "prompt", "brand_source", "calendar_plan", "platform_export_metadata"] as const;
    const requested = await createWorkspaceExport(repository, [...kinds]);
    const list = vi.fn(async () => kinds.map((kind, index) => ({ kind, sourceId: `${kind}-${index}`, digest: `sha256:${String(index + 1).repeat(64)}`, payload: { schema: `portable-${kind}/v1` } })));
    const signingKey = Buffer.alloc(32, 2);
    const worker = new GovernanceExportWorker(repository, store, {
      encryptionKeyBase64: Buffer.alloc(32, 1).toString("base64"),
      signingKeyBase64: signingKey.toString("base64"),
    }, { now: () => new Date("2026-09-03T12:01:00.000Z") }, undefined, { list, materialize: async () => ({ kind: "unavailable", reason: "unused" }) });
    await worker.process({ workspaceId: actor.workspaceId, kind: "workspace_export", exportId: requested.exportId });
    expect(list).toHaveBeenCalledWith({ workspaceId: actor.workspaceId, kinds: [...kinds] });
    const job = await repository.getResource<{ importAuthorization: { items: Array<{ kind: string; digest: string; payload: Record<string, unknown> }>; manifestKeyId: string; manifestSignature: string } }>({ workspaceId: actor.workspaceId, kind: "workspace_export", id: requested.exportId });
    expect(job?.body.importAuthorization).toMatchObject({
      manifestKeyId: "workspace-export-signing-v1",
      manifestSignature: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
      items: kinds.map((kind, index) => ({ kind, digest: `sha256:${String(index + 1).repeat(64)}`, payload: { schema: `portable-${kind}/v1` } })),
    });
  });

  it("round-trips an export-produced authorization directly into a verified import", async () => {
    const repository = new InMemoryGovernanceRepository();
    const store = new MemoryStore();
    const signingKey = Buffer.alloc(32, 9);
    const body = { schema: "portable-prompt/v1", id: "prompt-source", mode: "copy", name: "Launch", promptText: "Write", formConfig: {}, isPublic: false, createdAt: now.toISOString(), updatedAt: now.toISOString() };
    const requested = await createWorkspaceExport(repository, ["prompt"]);
    const portableData = { list: async () => [{ kind: "prompt" as const, sourceId: "prompt-source", digest: canonicalDigest(body), payload: body }], materialize: vi.fn(async () => ({ kind: "created" as const, destinationId: "prompt-destination" })) };
    await new GovernanceExportWorker(repository, store, { encryptionKeyBase64: Buffer.alloc(32, 1).toString("base64"), signingKeyBase64: signingKey.toString("base64") }, { now: () => new Date("2026-09-03T12:01:00.000Z") }, undefined, portableData)
      .process({ workspaceId: actor.workspaceId, kind: "workspace_export", exportId: requested.exportId });
    const exported = await repository.getResource<{ importAuthorization: { source: string; sourceManifestDigest: string; manifestKeyId: string; manifestSignature: string; items: Array<{ kind: string; sourceId: string; digest: string; transferable: boolean; payload: Record<string, unknown> }> } }>({ workspaceId: actor.workspaceId, kind: "workspace_export", id: requested.exportId });
    const authorization = exported!.body.importAuthorization;
    const destinationActor = { workspaceId: "workspace-b", userId: "owner-b", legacyRole: "owner" as const, authContextId: "session-owner-b" };
    const service = new GovernanceService(repository, { now: () => new Date("2026-09-03T12:02:00.000Z") }, undefined, undefined, new HmacGovernanceImportManifestVerifier(new Map([[authorization.manifestKeyId, signingKey]])));
    const preview = await service.execute(destinationActor, {
      type: "preview_import",
      source: authorization.source,
      sourceManifestDigest: authorization.sourceManifestDigest,
      manifestKeyId: authorization.manifestKeyId,
      manifestSignature: authorization.manifestSignature,
      items: authorization.items,
    }, "roundtrip-preview") as { importId: string };
    await service.execute(destinationActor, { type: "execute_import", importId: preview.importId }, "roundtrip-execute");
    await new GovernanceImportWorker(repository, { now: () => new Date("2026-09-03T12:03:00.000Z") }, portableData)
      .process({ workspaceId: destinationActor.workspaceId, importId: preview.importId });

    expect(portableData.materialize).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: "workspace-b", kind: "prompt", sourceId: "prompt-source", payload: body }));
  });

  it("enforces the immutable requesting principal, authority snapshot, and scope before export", async () => {
    const repository = new InMemoryGovernanceRepository();
    const store = new MemoryStore();
    const requested = await createWorkspaceExport(repository);
    const job = await repository.getResource({ workspaceId: actor.workspaceId, kind: "workspace_export", id: requested.exportId });
    const next = { ...job!, version: job!.version + 1, body: { ...job!.body, requestedByUserId: "attacker" }, updatedAt: now };
    await repository.commit({ receipt: { workspaceId: actor.workspaceId, capability: "test.tamper@1", idempotencyKey: "tamper-export-authority", requestDigest: canonicalDigest({ id: job!.id }), result: {}, createdAt: now }, mutations: [{ type: "update", expectedVersion: job!.version, resource: next }], audit: { schema: "workspace-audit-event/v1", id: "audit-tamper", workspaceId: actor.workspaceId, actor: { kind: "system", id: null }, capability: "test.tamper@1", action: "tamper", resource: null, outcome: "completed", redactedDetails: {}, occurredAt: now } });
    const worker = new GovernanceExportWorker(repository, store, { encryptionKeyBase64: Buffer.alloc(32, 1).toString("base64"), signingKeyBase64: Buffer.alloc(32, 2).toString("base64") });
    await expect(worker.process({ workspaceId: actor.workspaceId, kind: "workspace_export", exportId: requested.exportId })).rejects.toThrow("ExportAuthoritySnapshotInvalid");
    expect(store.values.size).toBe(0);
    expect((await repository.getResource({ workspaceId: actor.workspaceId, kind: "workspace_export", id: requested.exportId }))?.status).toBe("failed_known");
  });

  it("uses an exclusive lease so concurrent workers cannot overwrite one artifact", async () => {
    const repository = new InMemoryGovernanceRepository();
    const store = new MemoryStore();
    const put = vi.spyOn(store, "put");
    const requested = await createWorkspaceExport(repository);
    const keys = { encryptionKeyBase64: Buffer.alloc(32, 1).toString("base64"), signingKeyBase64: Buffer.alloc(32, 2).toString("base64") };
    await Promise.all([
      new GovernanceExportWorker(repository, store, keys).process({ workspaceId: actor.workspaceId, kind: "workspace_export", exportId: requested.exportId }),
      new GovernanceExportWorker(repository, store, keys).process({ workspaceId: actor.workspaceId, kind: "workspace_export", exportId: requested.exportId }),
    ]);
    expect(put).toHaveBeenCalledTimes(1);
    const job = await repository.getResource<{ artifactRef: string; lease: { id: string } }>({ workspaceId: actor.workspaceId, kind: "workspace_export", id: requested.exportId });
    expect(job?.status).toBe("succeeded");
    expect(job?.body.artifactRef).toContain(job!.body.lease.id);
  });

  it("paginates through the complete append-only audit trail", async () => {
    const repository = new InMemoryGovernanceRepository();
    const requested = await createWorkspaceExport(repository);
    const events = Array.from({ length: 501 }, (_, index) => ({
      schema: "workspace-audit-event/v1" as const,
      id: `audit-${index + 1}`,
      sequence: index + 1,
      workspaceId: actor.workspaceId,
      actor: { kind: "system" as const, id: null },
      capability: "test.audit@1",
      action: "seed",
      resource: { kind: "test", id: `${index + 1}` },
      outcome: "completed" as const,
      redactedDetails: {},
      occurredAt: new Date(now),
    }));
    const listAudit = vi.spyOn(repository, "listAudit").mockImplementation(async ({ afterSequence, limit }) =>
      events.filter((event) => event.sequence > (afterSequence ?? 0)).slice(0, limit));
    const worker = new GovernanceExportWorker(repository, new MemoryStore(), {
      encryptionKeyBase64: Buffer.alloc(32, 1).toString("base64"),
      signingKeyBase64: Buffer.alloc(32, 2).toString("base64"),
    });

    await worker.process({ workspaceId: actor.workspaceId, kind: "workspace_export", exportId: requested.exportId });

    expect(listAudit).toHaveBeenNthCalledWith(1, {
      workspaceId: actor.workspaceId,
      afterSequence: undefined,
      limit: 500,
    });
    expect(listAudit).toHaveBeenNthCalledWith(2, {
      workspaceId: actor.workspaceId,
      afterSequence: 500,
      limit: 500,
    });
  });
});
