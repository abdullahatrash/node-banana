import { createHash } from "node:crypto";

export function workflowRunWorkerId(stepId: string): string {
  if (!stepId) {
    throw new TypeError("Workflow step identity is unavailable.");
  }
  return `worker_${createHash("sha256").update(stepId, "utf8").digest("hex")}`;
}
