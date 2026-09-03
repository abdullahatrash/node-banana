import { describe, expect, it } from "vitest";
import { MemoryOperationStatusRepository } from "../memory-repository";
import { synchronizeOperationProjections } from "../projection-sync";
import { OperationStatusService } from "../service";
describe("operation projection synchronizer", () => {
  it("materializes source jumps as valid monotonic events", async () => { const service = new OperationStatusService(new MemoryOperationStatusRepository(), () => new Date("2026-09-03T00:00:00Z")); const summary = await synchronizeOperationProjections(service, [{ adapterId: "publishing-deliveries/v1", kind: "publishing_delivery", workspaceId: "ws", resourceId: "delivery", state: "succeeded", stage: null, updatedAt: new Date("2026-09-03T00:00:00Z"), metadata: {} }]); expect(summary).toEqual({ created: 1, transitioned: 3, unchanged: 0, conflicts: 0 }); const operation = await service.get("ws", "publishing_delivery:delivery"); expect(operation?.state).toBe("succeeded"); expect((await service.listEvents("ws", operation!.id)).map((event) => event.to)).toEqual(["queued", "admitted", "running", "succeeded"]); });
});
