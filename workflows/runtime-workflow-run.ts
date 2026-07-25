export interface RuntimeWorkflowRunInput {
  workspaceId: string;
  runId: string;
}

export async function executeRuntimeWorkflowRun(
  input: RuntimeWorkflowRunInput,
): Promise<{ runId: string; state: string }> {
  "use workflow";

  let result: { runId: string; state: string } | undefined;
  for (let iteration = 1; iteration <= 64; iteration += 1) {
    result = await executeRuntimeWorkflowRunStep({ ...input, iteration });
    if (result.state === "completed" || result.state === "failed") {
      return result;
    }
  }
  throw new Error("Workflow Run exceeded the 64-step execution bound.");
}

async function executeRuntimeWorkflowRunStep(
  input: RuntimeWorkflowRunInput & { iteration: number },
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
