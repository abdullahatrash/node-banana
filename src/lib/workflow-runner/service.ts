import { defaultRunnerDeps, type ProviderKeys } from "./defaultDeps";
import { planExecution } from "./graph";
import { executeWorkflow } from "./runner";
import {
  completeWorkflowRun,
  markWorkflowRunRunning,
  updateWorkflowRunProgress,
} from "./runsRepository";
import type { RunProgress, WorkflowGraph } from "./types";

/**
 * Serverless-honesty note: background execution here is a fire-and-forget
 * promise inside the same request lifecycle. On a serverless host the function
 * may be frozen/killed once the HTTP response is sent, so a long run can be cut
 * off — the run row is then left in `running` until a future sweep. This is the
 * documented MVP constraint; a durable queue (QStash / Workflow SDK) is the
 * follow-up. Kept as a single seam so it can be swapped without touching tools.
 */
export function scheduleBackground(task: () => Promise<void>): void {
  void task().catch((error) => {
    console.error("[workflow-run] background execution failed", error);
  });
}

/** Build the initial all-pending progress snapshot for a planned graph. */
export function initialProgress(graph: WorkflowGraph): RunProgress {
  return {
    nodes: planExecution(graph).map((node) => ({
      nodeId: node.id,
      type: node.type,
      status: "pending" as const,
    })),
  };
}

export interface ExecuteRunParams {
  runId: string;
  workspaceId: string;
  projectId: string;
  userId: string;
  keys: ProviderKeys;
  graph: WorkflowGraph;
}

/**
 * Drive one run to a terminal state: mark running, execute the graph while
 * streaming per-node progress into the row, then write the final status,
 * outputs, and any error. Never throws — failures are recorded on the row.
 */
export async function executeRunInBackground(
  params: ExecuteRunParams,
): Promise<void> {
  const { runId, workspaceId, projectId, userId, keys, graph } = params;

  try {
    await markWorkflowRunRunning(runId, initialProgress(graph));

    const deps = defaultRunnerDeps({
      workspaceId,
      projectId,
      userId,
      keys,
      onProgress: (progress) => updateWorkflowRunProgress(runId, progress),
    });

    const result = await executeWorkflow(graph, deps);

    await completeWorkflowRun(runId, {
      status: result.status,
      progress: result.progress,
      outputs: result.outputs,
      errorCode: result.error?.code ?? null,
      errorMessage: result.error?.message ?? null,
    });
  } catch (error) {
    // Defensive: executeWorkflow shouldn't throw, but guarantee the row lands
    // in a terminal state rather than stuck at `running`.
    await completeWorkflowRun(runId, {
      status: "failed",
      progress: { nodes: [] },
      outputs: [],
      errorCode: "internal",
      errorMessage: error instanceof Error ? error.message : String(error),
    }).catch(() => undefined);
  }
}
