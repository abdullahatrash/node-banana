import { getDb } from "@/lib/db";
import {
  GOLDEN_WORKFLOW_OPERATION_REGISTRY,
} from "@/lib/agent-runtime/workflows";
import { DrizzleWorkflowRevisionRepository } from
  "@/lib/agent-runtime/workflows/postgres-repository";
import {
  AesGcmWorkflowRunEventCursorCodec,
  workflowRunCursorKeysFromEnvironment,
} from "./cursor";
import { createDeterministicWorkflowRunExecutorRegistry } from "./executors";
import { DrizzleWorkflowRunRepository } from "./postgres-repository";
import { DurableWorkflowRunQueue } from "./queue";
import { WorkflowRunService } from "./service";

export const PRODUCTION_WORKFLOW_RUN_SERVICE = new WorkflowRunService(
  new DrizzleWorkflowRunRepository(getDb),
  new DrizzleWorkflowRevisionRepository(getDb),
  new DurableWorkflowRunQueue(),
  createDeterministicWorkflowRunExecutorRegistry(
    GOLDEN_WORKFLOW_OPERATION_REGISTRY,
  ),
  new AesGcmWorkflowRunEventCursorCodec(
    workflowRunCursorKeysFromEnvironment,
  ),
);

export async function executeProductionWorkflowRun(input: {
  workspaceId: string;
  runId: string;
  workerId: string;
}): Promise<{ runId: string; state: string }> {
  const run = await PRODUCTION_WORKFLOW_RUN_SERVICE.executeOne({
    workspaceId: input.workspaceId,
    runId: input.runId,
    workerId: input.workerId,
  });
  return { runId: run.id, state: run.state };
}
