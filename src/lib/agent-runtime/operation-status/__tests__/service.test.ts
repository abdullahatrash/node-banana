import { describe, expect, it } from "vitest";
import { MemoryOperationStatusRepository } from "../memory-repository";
import { OperationStatusService } from "../service";

const actor = { type: "human" as const, userId: "user-1" };

describe("OperationStatusService", () => {
  it("enforces named running stages, monotonic revisions, redaction and idempotency", async () => {
    const repo = new MemoryOperationStatusRepository();
    const service = new OperationStatusService(repo, () => new Date("2026-09-03T00:00:00Z"));
    const created = await service.create({ workspaceId: "ws-1", kind: "generation", resourceId: "gen-1", actor, idempotencyKey: "create-0001", metadata: { region: "eu", prompt: "secret", apiKey: "secret" } });
    expect(created.kind).toBe("applied");
    if (created.kind !== "applied") return;
    expect(created.operation.metadata).toEqual({ region: "eu" });
    const admitted = await service.transition({ workspaceId: "ws-1", operationId: created.operation.id, expectedRevision: 1, to: "admitted", reasonCode: "quota.admitted", actor, idempotencyKey: "admit-0001" });
    expect(admitted.kind).toBe("applied");
    const invalid = await service.transition({ workspaceId: "ws-1", operationId: created.operation.id, expectedRevision: 2, to: "running", reasonCode: "worker.started", actor, idempotencyKey: "run-invalid", stage: null });
    expect(invalid.kind).toBe("conflict");
    const running = await service.transition({ workspaceId: "ws-1", operationId: created.operation.id, expectedRevision: 2, to: "running", stage: "provider.submit", reasonCode: "worker.started", actor, idempotencyKey: "run-00001" });
    expect(running.kind).toBe("applied");
    const replay = await service.transition({ workspaceId: "ws-1", operationId: created.operation.id, expectedRevision: 2, to: "running", stage: "provider.submit", reasonCode: "worker.started", actor, idempotencyKey: "run-00001" });
    expect(replay.kind).toBe("replayed");
    expect((await service.listEvents("ws-1", created.operation.id)).map((item) => item.revision)).toEqual([1, 2, 3]);
  });

  it("makes ambiguous outcomes non-retryable until reconciled", async () => {
    const repo = new MemoryOperationStatusRepository();
    const service = new OperationStatusService(repo);
    const created = await service.create({ workspaceId: "ws", kind: "publishing_delivery", resourceId: "delivery", actor, idempotencyKey: "create-0002" });
    if (created.kind !== "applied") throw new Error("create failed");
    await service.transition({ workspaceId: "ws", operationId: created.operation.id, expectedRevision: 1, to: "admitted", reasonCode: "delivery.admitted", actor, idempotencyKey: "admit-0002" });
    await service.transition({ workspaceId: "ws", operationId: created.operation.id, expectedRevision: 2, to: "running", stage: "provider.publish", reasonCode: "delivery.started", actor, idempotencyKey: "run-00002" });
    const unknown = await service.transition({ workspaceId: "ws", operationId: created.operation.id, expectedRevision: 3, to: "outcome_unknown", reasonCode: "provider.transport_lost", actor, idempotencyKey: "unknown-02" });
    expect(unknown.kind).toBe("applied");
    expect((await service.retry({ workspaceId: "ws", operationId: created.operation.id, actor, idempotencyKey: "retry-0002" })).kind).toBe("conflict");
    expect((await service.transition({ workspaceId: "ws", operationId: created.operation.id, expectedRevision: 4, to: "succeeded", reasonCode: "provider.reconciled", actor, idempotencyKey: "recon-0002" })).kind).toBe("applied");
  });

  it("requests cancellation without inventing provider success", async () => {
    const repo = new MemoryOperationStatusRepository();
    const service = new OperationStatusService(repo);
    const queued = await service.create({ workspaceId: "ws", kind: "automation", resourceId: "occ-1", actor, idempotencyKey: "create-0003" });
    if (queued.kind !== "applied") throw new Error("create failed");
    const cancelled = await service.requestCancellation({ workspaceId: "ws", operationId: queued.operation.id, expectedRevision: 1, actor, idempotencyKey: "cancel-003" });
    expect(cancelled.kind === "applied" && cancelled.operation.state).toBe("cancelled");
  });
});
