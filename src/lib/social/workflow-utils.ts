export function resolveWorkflowRunRef(
  workflowRun: unknown,
  fallbackKey: string,
): string {
  if (workflowRun && typeof workflowRun === "object") {
    const candidate = workflowRun as {
      id?: unknown;
      runId?: unknown;
      workflowId?: unknown;
    };

    if (typeof candidate.runId === "string" && candidate.runId.trim()) {
      return candidate.runId;
    }
    if (typeof candidate.workflowId === "string" && candidate.workflowId.trim()) {
      return candidate.workflowId;
    }
    if (typeof candidate.id === "string" && candidate.id.trim()) {
      return candidate.id;
    }
  }

  return `${fallbackKey}:${Date.now()}`;
}
