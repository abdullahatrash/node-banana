import { describe, expect, it, vi } from "vitest";
import { GovernanceBulkWorker } from "../bulk-worker";
import { InMemoryGovernanceRepository } from "../memory-repository";
import { GovernanceService } from "../service";
import { canonicalDigest } from "@/lib/agent-tools/canonical";

const now = new Date("2026-09-03T12:00:00.000Z");
const actor = { workspaceId: "portfolio-workspace", userId: "owner-a", legacyRole: "owner" as const };

describe("GovernanceBulkWorker", () => {
  it("reauthorizes every pinned target Workspace and records independent outcomes", async () => {
    const repository = new InMemoryGovernanceRepository();
    const service = new GovernanceService(repository, { now: () => new Date(now) });
    const preview = await service.execute(actor, {
      type: "preview_bulk", operationCapability: "content.archive@1", concurrency: 2, quoteRef: "quote-1",
      items: [
        { targetWorkspaceId: "workspace-authorized", targetKind: "content", targetId: "content-1", input: { contentId: "content-1" } },
        { targetWorkspaceId: "workspace-forbidden", targetKind: "content", targetId: "content-2", input: { contentId: "content-2" } },
        { targetWorkspaceId: "workspace-uncertain", targetKind: "content", targetId: "content-3", input: { contentId: "content-3" } },
      ],
    }, "preview-bulk-worker") as { operationId: string };
    await service.execute(actor, { type: "start_bulk", operationId: preview.operationId }, "start-bulk-worker");
    const execute = vi.fn().mockImplementation(async ({ actor: targetActor }: { actor: { workspaceId: string } }) => targetActor.workspaceId === "workspace-uncertain"
      ? { type: "outcome_unknown", safeReason: "provider_timeout" }
      : { type: "succeeded", output: { archived: true } });
    const resolveActor = vi.fn().mockImplementation(async ({ targetWorkspaceId, userId }) => targetWorkspaceId === "workspace-forbidden" ? null : ({ workspaceId: targetWorkspaceId, userId, legacyRole: "admin" }));
    const worker = new GovernanceBulkWorker(repository, { resolveActor }, { execute }, { now: () => new Date("2026-09-03T12:01:00.000Z") });
    await worker.process({ workspaceId: actor.workspaceId, operationId: preview.operationId });

    const operation = await repository.getResource<{ items: Array<{ state: string; outcome: Record<string, unknown> }> }>({ workspaceId: actor.workspaceId, kind: "bulk_operation", id: preview.operationId });
    expect(operation?.status).toBe("outcome_unknown");
    expect(operation?.body.items.map((item) => item.state)).toEqual(["succeeded", "failed_known", "outcome_unknown"]);
    expect(operation?.body.items[1].outcome).toEqual({ code: "TARGET_WORKSPACE_FORBIDDEN" });
    expect(execute).toHaveBeenCalledTimes(2);
    expect(execute.mock.calls[0][0]).toMatchObject({ actor: { workspaceId: "workspace-authorized" }, capability: "content.archive@1", idempotencyKey: expect.stringContaining(preview.operationId) });
    expect(resolveActor).toHaveBeenCalledWith(expect.objectContaining({ sourceWorkspaceId: actor.workspaceId, targetWorkspaceId: "workspace-authorized", userId: actor.userId, capability: "content.archive@1", targetKind: "content", targetId: "content-1", evaluatedAt: new Date("2026-09-03T12:01:00.000Z") }));
  });

  it("turns items left running by an interrupted worker into ambiguity instead of replaying", async () => {
    const repository = new InMemoryGovernanceRepository();
    const service = new GovernanceService(repository, { now: () => new Date(now) });
    const preview = await service.execute(actor, { type: "preview_bulk", operationCapability: "content.archive@1", concurrency: 1, quoteRef: null, items: [{ targetWorkspaceId: "workspace-a", targetKind: "content", targetId: "content-a" }] }, "preview-interrupted-bulk") as { operationId: string };
    await service.execute(actor, { type: "start_bulk", operationId: preview.operationId }, "start-interrupted-bulk");
    const queued = await repository.getResource({ workspaceId: actor.workspaceId, kind: "bulk_operation", id: preview.operationId });
    await repository.commit({ receipt: { workspaceId: actor.workspaceId, capability: "test.bulk@1", idempotencyKey: "simulate-interrupted-bulk", requestDigest: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", result: {}, createdAt: now }, mutations: [{ type: "update", expectedVersion: queued!.version, resource: { ...queued!, version: queued!.version + 1, status: "running", body: { ...queued!.body, items: (queued!.body as { items: Array<Record<string, unknown>> }).items.map((item) => ({ ...item, state: "running" })) }, updatedAt: now } }], audit: { schema: "workspace-audit-event/v1", id: "audit-interrupted", workspaceId: actor.workspaceId, actor: { kind: "system", id: null }, capability: "test.bulk@1", action: "interrupt", resource: null, outcome: "failed", redactedDetails: {}, occurredAt: now } });
    const execute = vi.fn();
    await new GovernanceBulkWorker(repository, { resolveActor: vi.fn() }, { execute }).process({ workspaceId: actor.workspaceId, operationId: preview.operationId });
    expect((await repository.getResource({ workspaceId: actor.workspaceId, kind: "bulk_operation", id: preview.operationId }))?.status).toBe("outcome_unknown");
    expect(execute).not.toHaveBeenCalled();
  });

  it("claims an exclusive lease so concurrent workers dispatch each item once", async () => {
    const repository = new InMemoryGovernanceRepository();
    const service = new GovernanceService(repository, { now: () => new Date(now) });
    const preview = await service.execute(actor, { type: "preview_bulk", operationCapability: "content.archive@1", concurrency: 1, quoteRef: null, items: [{ targetWorkspaceId: "workspace-a", targetKind: "content", targetId: "content-a" }] }, "preview-concurrent-bulk") as { operationId: string };
    await service.execute(actor, { type: "start_bulk", operationId: preview.operationId }, "start-concurrent-bulk");
    const execute = vi.fn(async () => ({ type: "succeeded" as const, output: { archived: true } }));
    const authorization = { resolveActor: vi.fn(async ({ targetWorkspaceId, userId }: { targetWorkspaceId: string; userId: string }) => ({ workspaceId: targetWorkspaceId, userId, legacyRole: "admin" as const })) };
    const clock = { now: () => new Date("2026-09-03T12:01:00.000Z") };
    await Promise.all([
      new GovernanceBulkWorker(repository, authorization, { execute }, clock).process({ workspaceId: actor.workspaceId, operationId: preview.operationId }),
      new GovernanceBulkWorker(repository, authorization, { execute }, clock).process({ workspaceId: actor.workspaceId, operationId: preview.operationId }),
    ]);
    expect(execute).toHaveBeenCalledTimes(1);
    expect((await repository.getResource({ workspaceId: actor.workspaceId, kind: "bulk_operation", id: preview.operationId }))?.status).toBe("succeeded");
  });

  it("provides a sweeper entry point for expired leases", async () => {
    let current = new Date(now);
    const repository = new InMemoryGovernanceRepository();
    const service = new GovernanceService(repository, { now: () => new Date(now) });
    const preview = await service.execute(actor, { type: "preview_bulk", operationCapability: "content.archive@1", concurrency: 1, quoteRef: null, items: [{ targetWorkspaceId: "workspace-a", targetKind: "content", targetId: "content-a" }] }, "preview-expired-bulk") as { operationId: string };
    await service.execute(actor, { type: "start_bulk", operationId: preview.operationId }, "start-expired-bulk");
    const queued = await repository.getResource({ workspaceId: actor.workspaceId, kind: "bulk_operation", id: preview.operationId });
    const leased = { ...queued!, version: queued!.version + 1, status: "running", body: { ...queued!.body, lease: { id: "lease-old", claimedAt: now.toISOString(), expiresAt: "2026-09-03T12:05:00.000Z", attempt: 1 } }, updatedAt: now };
    await repository.commit({ receipt: { workspaceId: actor.workspaceId, capability: "test.lease@1", idempotencyKey: "simulate-bulk-lease", requestDigest: canonicalDigest({ id: queued!.id }), result: {}, createdAt: now }, mutations: [{ type: "update", expectedVersion: queued!.version, resource: leased }], audit: { schema: "workspace-audit-event/v1", id: "audit-lease", workspaceId: actor.workspaceId, actor: { kind: "system", id: null }, capability: "test.lease@1", action: "lease", resource: null, outcome: "completed", redactedDetails: {}, occurredAt: now } });
    const worker = new GovernanceBulkWorker(repository, { resolveActor: async ({ targetWorkspaceId, userId }) => ({ workspaceId: targetWorkspaceId, userId, legacyRole: "admin" }) }, { execute: async () => ({ type: "succeeded", output: {} }) }, { now: () => current });
    expect(await worker.recoverExpired({ workspaceId: actor.workspaceId })).toBe(0);
    current = new Date("2026-09-03T12:06:00.000Z");
    expect(await worker.recoverExpired({ workspaceId: actor.workspaceId })).toBe(1);
    expect((await repository.getResource({ workspaceId: actor.workspaceId, kind: "bulk_operation", id: preview.operationId }))?.status).toBe("succeeded");
  });
});
