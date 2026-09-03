import { describe, expect, it, vi } from "vitest";
import { InMemoryGovernanceRepository } from "../memory-repository";
import { GovernanceService } from "../service";
import { GovernanceExportWorker, type GovernanceExportStore } from "../export-worker";

const now = new Date("2026-09-03T12:00:00.000Z");
const actor = { workspaceId: "workspace-a", userId: "owner-a", legacyRole: "owner" as const };

class MemoryStore implements GovernanceExportStore {
  values = new Map<string, Uint8Array>();
  async put(input: { key: string; bytes: Uint8Array }) { this.values.set(input.key, input.bytes); }
}

async function createWorkspaceExport(repository: InMemoryGovernanceRepository) {
  const service = new GovernanceService(repository, { now: () => new Date(now) });
  await service.execute(actor, { type: "create_portfolio", name: "Client portfolio" }, "portfolio-before-export");
  const challenge = await service.execute(actor, { type: "begin_step_up", purpose: "exports.manage", resourceId: null }, "begin-export-stepup") as { challengeId: string; verificationCode: string };
  const session = await service.execute(actor, { type: "verify_step_up", challengeId: challenge.challengeId, code: challenge.verificationCode }, "verify-export-stepup") as { stepUpToken: string };
  return service.execute(actor, { type: "request_workspace_export", includeKinds: ["portfolio"], stepUpToken: session.stepUpToken }, "request-workspace-export") as Promise<{ exportId: string }>;
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
