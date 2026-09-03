import { describe, expect, it, vi } from "vitest";
import { canonicalDigest } from "@/lib/agent-tools/canonical";
import { InMemoryGovernanceRepository } from "../memory-repository";
import { GovernanceRecoverySweep } from "../sweeper";

const now = new Date("2026-09-03T12:00:00.000Z");

describe("GovernanceRecoverySweep", () => {
  it("dispatches every durable queued or recoverable lifecycle through its leased worker", async () => {
    const repository = new InMemoryGovernanceRepository();
    const definitions = [
      ["workspace_export", "export-1", "queued"],
      ["bulk_operation", "bulk-1", "running"],
      ["workspace_import", "import-1", "queued"],
      ["deletion_receipt", "delete-1", "queued"],
      ["safety_appeal", "appeal-1", "revalidation_queued"],
      ["workspace_closure", "closure-1", "erasure_queued"],
      ["portfolio", "ignored-1", "active"],
    ] as const;
    await repository.commit({
      receipt: { workspaceId: "workspace-a", capability: "test.seed@1", idempotencyKey: "seed-sweep", requestDigest: canonicalDigest(definitions), result: {}, createdAt: now },
      mutations: definitions.map(([kind, id, status]) => ({ type: "create" as const, expectedVersion: null, resource: { id, workspaceId: "workspace-a", kind, version: 1, status, body: {}, createdByUserId: "owner-a", createdAt: now, updatedAt: now } })),
      audit: { schema: "workspace-audit-event/v1", id: "audit-seed-sweep", workspaceId: "workspace-a", actor: { kind: "system", id: null }, capability: "test.seed@1", action: "seed", resource: null, outcome: "completed", redactedDetails: {}, occurredAt: now },
    });
    const workers = {
      export: { process: vi.fn(async () => undefined) },
      bulk: { process: vi.fn(async () => undefined) },
      import: { process: vi.fn(async () => undefined) },
      deletion: { process: vi.fn(async () => undefined) },
      safety: { process: vi.fn(async () => undefined) },
      approvals: { processWorkspace: vi.fn(async () => 2) },
      membership: { sweep: vi.fn(async () => ({ scanned: 1, succeeded: 1, retryPending: 0, deadLetter: 0 })) },
      secrets: { purge: vi.fn(async () => 3) },
      closure: { process: vi.fn(async () => undefined) },
    };

    const summary = await new GovernanceRecoverySweep(repository, workers).run({ maxJobs: 100, evaluatedAt: now });

    expect(summary).toEqual({ workspaces: 1, examined: 6, dispatched: 6, failed: 0, deadlinesAdvanced: 2, membershipProjection: { scanned: 1, succeeded: 1, retryPending: 0, deadLetter: 0 }, expiredSecretDeliveriesPurged: 3, nextCursor: null });
    expect(workers.export.process).toHaveBeenCalledWith({ workspaceId: "workspace-a", kind: "workspace_export", exportId: "export-1" });
    expect(workers.bulk.process).toHaveBeenCalledWith({ workspaceId: "workspace-a", operationId: "bulk-1" });
    expect(workers.import.process).toHaveBeenCalledWith({ workspaceId: "workspace-a", importId: "import-1" });
    expect(workers.deletion.process).toHaveBeenCalledWith({ workspaceId: "workspace-a", deletionReceiptId: "delete-1" });
    expect(workers.safety.process).toHaveBeenCalledWith({ workspaceId: "workspace-a", appealId: "appeal-1" });
    expect(workers.closure.process).toHaveBeenCalledWith({ workspaceId: "workspace-a", closureId: "closure-1" });
    expect(workers.membership.sweep).toHaveBeenCalledWith({ limit: 100 });
    expect(workers.secrets.purge).toHaveBeenCalledWith({ limit: 100 });
  });

  it("selects oldest claimable jobs globally and advances a stable cross-workspace cursor", async () => {
    const repository = new InMemoryGovernanceRepository();
    const jobs = [
      { workspaceId: "workspace-b", id: "newer", updatedAt: new Date("2026-09-03T11:00:00.000Z") },
      { workspaceId: "workspace-a", id: "oldest", updatedAt: new Date("2026-09-03T09:00:00.000Z") },
      { workspaceId: "workspace-c", id: "middle", updatedAt: new Date("2026-09-03T10:00:00.000Z") },
    ];
    for (const job of jobs) await repository.commit({ receipt: { workspaceId: job.workspaceId, capability: "test.seed@1", idempotencyKey: `seed-${job.id}`, requestDigest: canonicalDigest(job), result: {}, createdAt: job.updatedAt }, mutations: [{ type: "create", expectedVersion: null, resource: { ...job, kind: "workspace_export", version: 1, status: "queued", body: {}, createdByUserId: "owner", createdAt: job.updatedAt } }], audit: { schema: "workspace-audit-event/v1", id: `audit-${job.id}`, workspaceId: job.workspaceId, actor: { kind: "system", id: null }, capability: "test.seed@1", action: "seed", resource: null, outcome: "completed", redactedDetails: {}, occurredAt: job.updatedAt } });
    const process = vi.fn(async (_input: { workspaceId: string; exportId: string }) => undefined);
    const workers = { export: { process }, bulk: { process: vi.fn() }, import: { process: vi.fn() }, deletion: { process: vi.fn() }, safety: { process: vi.fn() }, approvals: { processWorkspace: vi.fn(async () => 0) }, membership: { sweep: vi.fn(async () => ({ scanned: 0, succeeded: 0, retryPending: 0, deadLetter: 0 })) }, secrets: { purge: vi.fn(async () => 0) }, closure: { process: vi.fn() } };
    const sweep = new GovernanceRecoverySweep(repository, workers);
    const first = await sweep.run({ maxJobs: 2, evaluatedAt: now });
    expect(process.mock.calls.map(([input]) => input.exportId)).toEqual(["oldest", "middle"]);
    expect(first.nextCursor).toMatchObject({ workspaceId: "workspace-c", id: "middle" });
    process.mockClear();
    await sweep.run({ maxJobs: 2, after: first.nextCursor!, evaluatedAt: now });
    expect(process).toHaveBeenCalledOnce();
    expect(process.mock.calls[0]?.[0]).toMatchObject({ workspaceId: "workspace-b", exportId: "newer" });
  });
});
