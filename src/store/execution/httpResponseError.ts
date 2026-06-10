/**
 * Shared HTTP error extraction for generation executors.
 * Parses the API error envelope ({ error: string }) with a truncated-text
 * fallback, marks the node as errored, and throws.
 */
import type { WorkflowNodeData } from "@/types";

export async function throwIfResponseError(
  response: Response,
  nodeId: string,
  updateNodeData: (nodeId: string, data: Partial<WorkflowNodeData>) => void,
): Promise<void> {
  if (response.ok) return;

  const errorText = await response.text();
  let errorMessage = `HTTP ${response.status}`;
  try {
    const errorJson = JSON.parse(errorText);
    errorMessage = errorJson.error || errorMessage;
  } catch {
    if (errorText) errorMessage += ` - ${errorText.substring(0, 200)}`;
  }

  updateNodeData(nodeId, { status: "error", error: errorMessage });
  throw new Error(errorMessage);
}
