import { start } from "workflow/api";
import { executeRuntimeWorkflowRun } from "@/../workflows/runtime-workflow-run";
import type { WorkflowRunQueue } from "./types";

export class DurableWorkflowRunQueue implements WorkflowRunQueue {
  async schedule(input: Parameters<WorkflowRunQueue["schedule"]>[0]) {
    const prefix =
      `workflow-run:${input.workspaceId}:${input.runId}:v`;
    const generation = input.dedupeKey.slice(prefix.length);
    if (
      !input.dedupeKey.startsWith(prefix) ||
      !/^[1-9][0-9]*$/.test(generation)
    ) {
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
