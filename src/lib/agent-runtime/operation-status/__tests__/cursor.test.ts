import { describe, expect, it } from "vitest";
import { openOperationCursor, operationFilterDigest, sealOperationCursor } from "../cursor";
import { MemoryOperationStatusRepository } from "../memory-repository";
import { OperationStatusService } from "../service";

const secret = "operation-cursor-test-secret-32-bytes-minimum";
describe("operation pagination cursor", () => {
  it("round trips an exact Workspace/filter/order position", () => { const filterDigest = operationFilterDigest(["waiting_provider"], ["generation"]); const cursor = sealOperationCursor({ workspaceId: "ws", filterDigest, updatedAt: new Date("2026-09-04T12:00:00.000Z"), id: "operation-1", secret }); expect(openOperationCursor({ cursor, workspaceId: "ws", filterDigest, secret })).toEqual({ updatedAt: new Date("2026-09-04T12:00:00.000Z"), id: "operation-1" }); });
  it("rejects tampering and cross-Workspace/filter replay", () => { const filterDigest = operationFilterDigest(); const cursor = sealOperationCursor({ workspaceId: "ws", filterDigest, updatedAt: new Date(), id: "operation-1", secret }); expect(() => openOperationCursor({ cursor: `${cursor}x`, workspaceId: "ws", filterDigest, secret })).toThrow(); expect(() => openOperationCursor({ cursor, workspaceId: "other", filterDigest, secret })).toThrow(); expect(() => openOperationCursor({ cursor, workspaceId: "ws", filterDigest: operationFilterDigest(["failed_known"]), secret })).toThrow(); });
  it("seek-paginates beyond the old 200-item projection cap without gaps or duplicates", async () => {
    const repository = new MemoryOperationStatusRepository();
    const service = new OperationStatusService(repository, () => new Date("2026-09-04T12:00:00.000Z"));
    for (let index = 0; index < 225; index++) {
      const result = await service.create({ workspaceId: "ws", kind: "ingestion", resourceId: `ingest-${index}`, actor: { type: "system", service: "test" }, idempotencyKey: `create-${index}` });
      expect(result.kind).toBe("applied");
    }
    const seen: string[] = [];
    let before: { updatedAt: Date; id: string } | undefined;
    do {
      const page = await service.list("ws", { limit: 100, before });
      seen.push(...page.map((item) => item.id));
      const last = page.at(-1);
      before = page.length === 100 && last ? { updatedAt: last.updatedAt, id: last.id } : undefined;
      if (page.length < 100) break;
    } while (before);
    expect(seen).toHaveLength(225);
    expect(new Set(seen)).toHaveLength(225);
  });
});
