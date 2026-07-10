import { z } from "zod";

import { getWorkflowRun } from "@/lib/workflow-runner/runsRepository";

import { ToolError } from "../errors";
import type { ToolDefinition } from "../types";

const inputSchema = z.object({
  runId: z.string().min(1),
});

const nodeProgressSchema = z.object({
  nodeId: z.string(),
  type: z.string(),
  status: z.enum(["pending", "running", "succeeded", "failed", "skipped"]),
  error: z.string().optional(),
});

const outputRefSchema = z.object({
  nodeId: z.string(),
  assetId: z.string(),
  url: z.string().nullable(),
});

const outputSchema = z.object({
  runId: z.string(),
  status: z.enum(["queued", "running", "succeeded", "failed", "cancelled"]),
  progress: z.object({ nodes: z.array(nodeProgressSchema) }),
  outputs: z.array(outputRefSchema),
  error: z
    .object({ code: z.string().nullable(), message: z.string().nullable() })
    .nullable(),
});

function toNodes(progress: unknown): z.infer<typeof nodeProgressSchema>[] {
  if (
    typeof progress !== "object" ||
    progress === null ||
    !Array.isArray((progress as { nodes?: unknown }).nodes)
  ) {
    return [];
  }
  const parsed = z
    .array(nodeProgressSchema)
    .safeParse((progress as { nodes: unknown[] }).nodes);
  return parsed.success ? parsed.data : [];
}

function toOutputs(outputs: unknown): z.infer<typeof outputRefSchema>[] {
  if (!Array.isArray(outputs)) return [];
  const parsed = z.array(outputRefSchema).safeParse(outputs);
  return parsed.success ? parsed.data : [];
}

/**
 * Report a run's current status, per-node progress, output asset refs, and any
 * error. Poll this after `run_workflow` until `status` is a terminal value
 * (`succeeded` / `failed` / `cancelled`).
 */
export const getRunStatusTool: ToolDefinition<
  typeof inputSchema,
  typeof outputSchema
> = {
  name: "get_run_status",
  description:
    "Get the status of a workflow run by runId: overall status, per-node progress, output asset ids/urls, and any error. Poll until status is succeeded, failed, or cancelled.",
  requiredPermission: "projects:read",
  inputSchema,
  outputSchema,
  handler: async (input, ctx) => {
    const run = await getWorkflowRun(ctx.session.workspace.id, input.runId);
    if (!run) {
      throw new ToolError({
        code: "not_found",
        message: `No run '${input.runId}' in this workspace.`,
        fix: "Check the runId returned by run_workflow and that the token targets the right workspace.",
      });
    }

    const hasError = Boolean(run.errorCode || run.errorMessage);

    return {
      runId: run.id,
      status: run.status,
      progress: { nodes: toNodes(run.progress) },
      outputs: toOutputs(run.outputs),
      error: hasError
        ? { code: run.errorCode ?? null, message: run.errorMessage ?? null }
        : null,
    };
  },
};
