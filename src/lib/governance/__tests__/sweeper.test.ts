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
      ["deletion_receipt", "delete-1", "delayed"],
      ["safety_appeal", "appeal-1", "revalidation_queued"],
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
    };

    const summary = await new GovernanceRecoverySweep(repository, workers).run({ workspaceIds: ["workspace-a"], maxJobsPerWorkspace: 100 });

    expect(summary).toEqual({ workspaces: 1, examined: 6, dispatched: 5, failed: 0, deadlinesAdvanced: 2, membershipProjection: { scanned: 1, succeeded: 1, retryPending: 0, deadLetter: 0 }, expiredSecretDeliveriesPurged: 3 });
    expect(workers.export.process).toHaveBeenCalledWith({ workspaceId: "workspace-a", kind: "workspace_export", exportId: "export-1" });
    expect(workers.bulk.process).toHaveBeenCalledWith({ workspaceId: "workspace-a", operationId: "bulk-1" });
    expect(workers.import.process).toHaveBeenCalledWith({ workspaceId: "workspace-a", importId: "import-1" });
    expect(workers.deletion.process).toHaveBeenCalledWith({ workspaceId: "workspace-a", deletionReceiptId: "delete-1" });
    expect(workers.safety.process).toHaveBeenCalledWith({ workspaceId: "workspace-a", appealId: "appeal-1" });
    expect(workers.membership.sweep).toHaveBeenCalledWith({ limit: 100 });
    expect(workers.secrets.purge).toHaveBeenCalledWith({ limit: 100 });
  });
});
