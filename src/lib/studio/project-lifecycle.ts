export function statusForProjectResave(
  workflowJson: Record<string, unknown> | null | undefined,
): "active" | undefined {
  return workflowJson ? "active" : undefined;
}
