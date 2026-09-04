import { describe, expect, it } from "vitest";
import { MemoryOperationStatusRepository } from "../memory-repository";
import { synchronizeBoundedOperationProjectionPages } from "../projection-sync";
import { OperationStatusService } from "../service";
import type { ProjectedSourceOperation } from "../source-reader";

describe("bounded operation projection", () => {
  it("checkpoints every page and resumes a large bootstrap without retaining the history", async () => {
    const rows: ProjectedSourceOperation[] = Array.from({ length: 1_201 }, (_, index) => ({
      adapterId: "workflow-runs/v1",
      checkpointId: "workflow-runs/v1",
      kind: "workflow_run",
      workspaceId: "ws",
      resourceId: `run-${String(index).padStart(5, "0")}`,
      state: "queued",
      stage: null,
      updatedAt: new Date(Date.UTC(2026, 8, 4, 0, 0, 0, index)),
      metadata: {},
    }));
    const service = new OperationStatusService(new MemoryOperationStatusRepository(), () => new Date("2026-09-04T01:00:00.000Z"));
    const persisted: Array<{ updatedAt: Date; resourceId: string }> = [];
    const run = (checkpoints: Record<string, { updatedAt: Date; resourceId: string }>, maxPages: number) => synchronizeBoundedOperationProjectionPages({
      service,
      sourceIds: ["workflow-runs/v1"],
      checkpoints,
      pageSize: 200,
      maxPages,
      renewLease: async () => true,
      readPage: async (_sourceId, checkpoint, pageSize) => rows.filter((row) => !checkpoint || row.updatedAt > checkpoint.updatedAt || row.updatedAt.getTime() === checkpoint.updatedAt.getTime() && row.resourceId > checkpoint.resourceId).slice(0, pageSize),
      persistPage: async (_sourceId, checkpoint) => { persisted.push(checkpoint); },
      shouldContinue: () => true,
    });

    const first = await run({}, 3);
    expect(first).toMatchObject({ pages: 3, created: 600, complete: false });
    expect(first.checkpoints["workflow-runs/v1"]?.resourceId).toBe("run-00599");
    const second = await run(first.checkpoints, 10);
    expect(second).toMatchObject({ pages: 4, created: 601, complete: true });
    expect(second.checkpoints["workflow-runs/v1"]?.resourceId).toBe("run-01200");
    expect(persisted).toHaveLength(7);
  });

  it("does not read a page after the Workspace lease is lost", async () => {
    const service = new OperationStatusService(new MemoryOperationStatusRepository());
    await expect(synchronizeBoundedOperationProjectionPages({ service, sourceIds: ["workflow-runs/v1"], checkpoints: {}, pageSize: 10, maxPages: 1, renewLease: async () => false, readPage: async () => { throw new Error("must not read"); }, persistPage: async () => undefined, shouldContinue: () => true })).rejects.toThrow("OPERATION_PROJECTION_LEASE_LOST");
  });
});
