import { describe, expect, it } from "vitest";
import { advanceOperationProjectionCheckpoints } from "../projection-checkpoints";

describe("operation projection checkpoints", () => {
  it("advances each physical source independently with a stable timestamp/id tie-breaker", () => {
    const first = new Date("2026-09-04T00:00:00.000Z"); const second = new Date("2026-09-04T00:01:00.000Z");
    const result = advanceOperationProjectionCheckpoints({ "workflow-runs/v1": { updatedAt: first, resourceId: "b" } }, [
      { adapterId: "workflow-runs/v1", kind: "workflow_run", workspaceId: "ws", resourceId: "a", state: "running", stage: "execute", updatedAt: first, metadata: {} },
      { adapterId: "governance-bulk/v1", checkpointId: "governance-resources/v1", kind: "governance_bulk", workspaceId: "ws", resourceId: "z", state: "succeeded", stage: null, updatedAt: second, metadata: {} },
    ]);
    expect(result["workflow-runs/v1"]).toEqual({ updatedAt: first, resourceId: "b" });
    expect(result["governance-resources/v1"]).toEqual({ updatedAt: second, resourceId: "z" });
  });
});
