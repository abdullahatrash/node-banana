export interface RuntimeWorkflowRunInput {
  workspaceId: string;
  runId: string;
}

export async function executeRuntimeWorkflowRun(
  input: RuntimeWorkflowRunInput,
): Promise<{ runId: string; state: string }> {
  "use workflow";

  return executeRuntimeWorkflowRunStep(input);
}

async function executeRuntimeWorkflowRunStep(
  input: RuntimeWorkflowRunInput,
): Promise<{ runId: string; state: string }> {
  "use step";

  const { getStepMetadata } = await import("workflow");
  const { workflowRunWorkerId } = await import(
    "@/lib/agent-runtime/runs/worker-identity"
  );
  const { executeProductionWorkflowRun } = await import(
    "@/lib/agent-runtime/runs/production"
  );
  return executeProductionWorkflowRun({
    ...input,
    workerId: workflowRunWorkerId(getStepMetadata().stepId),
  });
}
