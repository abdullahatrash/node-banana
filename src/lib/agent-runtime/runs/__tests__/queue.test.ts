import { beforeEach, describe, expect, it, vi } from "vitest";

const start = vi.fn();

vi.mock("workflow/api", () => ({ start }));

describe("DurableWorkflowRunQueue", () => {
  beforeEach(() => {
    start.mockReset();
    start.mockResolvedValue({ runId: "internal-sdk-id" });
  });

  it("schedules identifier-only reentrant work and ignores SDK identity", async () => {
    const { DurableWorkflowRunQueue } = await import("../queue");
    const queue = new DurableWorkflowRunQueue();

    await expect(
      queue.schedule({
        workspaceId: "workspace_1",
        runId: "run_1",
        dedupeKey: "workflow-run:workspace_1:run_1:v1",
      }),
    ).resolves.toBeUndefined();
    expect(start).toHaveBeenCalledWith(expect.any(Function), [{
      workspaceId: "workspace_1",
      runId: "run_1",
    }]);
    expect(JSON.stringify(start.mock.calls)).not.toContain("internal-sdk-id");
  });

  it("rejects a mismatched dispatch identity before scheduling", async () => {
    const { DurableWorkflowRunQueue } = await import("../queue");
    await expect(
      new DurableWorkflowRunQueue().schedule({
        workspaceId: "workspace_1",
        runId: "run_1",
        dedupeKey: "workflow-run:workspace_2:run_1:v1",
      }),
    ).rejects.toThrow("dispatch identity is invalid");
    expect(start).not.toHaveBeenCalled();
  });
});
