import { z } from "zod";

import { ToolError } from "../errors";
import type { ToolDefinition } from "../types";

const inputSchema = z.object({
  projectId: z.string().min(1),
  inputOverrides: z.record(z.string(), z.unknown()).optional(),
});

const outputSchema = z.object({
  runId: z.string(),
  status: z.string(),
});

/**
 * Workflow execution is fail-closed until every generative node uses the same
 * Brand, rights, region, quote, reservation, provider-effect and Operation
 * admission contract as Simple Studio. No legacy provider call is reachable.
 */
export const runWorkflowTool: ToolDefinition<
  typeof inputSchema,
  typeof outputSchema
> = {
  name: "run_workflow",
  description:
    "Workflow generation is temporarily unavailable while its admitted AI adapter is being qualified. لا يتم تنفيذ أي استدعاء مباشر لمزوّد الذكاء الاصطناعي.",
  requiredPermission: "projects:write",
  inputSchema,
  outputSchema,
  handler: async () => {
    throw new ToolError({
      code: "unavailable",
      message: "Workflow AI execution is unavailable until admitted provider adapters are qualified. التنفيذ بالذكاء الاصطناعي لسير العمل غير متاح حتى اعتماد موصلات المزوّدين.",
      fix: "Use Simple Studio with a qualified model, or inspect /studio/model-routing for admission readiness.",
    });
  },
};
