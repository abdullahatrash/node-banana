import { start } from "workflow/api";
import { executeRuntimeWorkflowRun } from "@/../workflows/runtime-workflow-run";
import type { WorkflowRunQueue } from "./types";

export class DurableWorkflowRunQueue implements WorkflowRunQueue {
  async schedule(input: Parameters<WorkflowRunQueue["schedule"]>[0]) {
    const expected =
      `workflow-run:${input.workspaceId}:${input.runId}:v1`;
    if (input.dedupeKey !== expected) {
      throw new Error("Workflow Run dispatch identity is invalid.");
    }

    // The Workflow SDK currently supplies its own execution ID. It is
    // deliberately ignored: the stable, user-visible identity remains the
    // PostgreSQL Workflow Run, and duplicate starts reenter that same Run.
    await start(executeRuntimeWorkflowRun, [{
      workspaceId: input.workspaceId,
      runId: input.runId,
    }]);
  }
}
