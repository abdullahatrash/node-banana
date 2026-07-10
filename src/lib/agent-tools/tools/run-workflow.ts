import { z } from "zod";

import { getProject } from "@/lib/studio/repository";
import {
  assertProviderKeys,
  makeRequestKeyResolver,
  parseWorkflowGraph,
  planExecution,
} from "@/lib/workflow-runner";
import { createWorkflowRun } from "@/lib/workflow-runner/runsRepository";
import {
  executeRunInBackground,
  initialProgress,
  scheduleBackground,
} from "@/lib/workflow-runner/service";

import { ToolError } from "../errors";
import type { ToolDefinition } from "../types";

const providerKeysSchema = z
  .object({
    gemini: z.string().optional(),
    google: z.string().optional(),
    openai: z.string().optional(),
    anthropic: z.string().optional(),
  })
  .optional();

const inputSchema = z.object({
  projectId: z.string().min(1),
  inputOverrides: z.record(z.string(), z.unknown()).optional(),
  providerKeys: providerKeysSchema,
});

const outputSchema = z.object({
  runId: z.string(),
  status: z.string(),
});

/**
 * Start an asynchronous server-side run of a saved project's workflow.
 *
 * Validation is synchronous and fail-fast — an unsupported node type yields
 * `unsupported_node`, a missing provider key yields the typed `byok_key_missing`
 * BYOK error, and a missing project yields `not_found` — so the caller learns of
 * a bad run before any row is created. On success a `queued` run row is created,
 * execution is scheduled in the background, and `{ runId }` returns immediately;
 * poll `get_run_status` for progress and output asset refs.
 */
export const runWorkflowTool: ToolDefinition<
  typeof inputSchema,
  typeof outputSchema
> = {
  name: "run_workflow",
  description:
    "Execute a saved project's workflow on the server. Supply projectId, optional inputOverrides, and providerKeys (BYOK). Returns a runId immediately; poll get_run_status for progress and output asset ids/urls. Only prompt, imageInput, llmGenerate, nanoBanana (Gemini) and output nodes are supported today.",
  requiredPermission: "projects:write",
  inputSchema,
  outputSchema,
  handler: async (input, ctx) => {
    const workspaceId = ctx.session.workspace.id;
    const userId = ctx.session.user.id;

    const project = await getProject(workspaceId, input.projectId);
    if (!project) {
      throw new ToolError({
        code: "not_found",
        message: `No project '${input.projectId}' in this workspace.`,
        fix: "List projects to find a valid id, or check the token targets the right workspace.",
      });
    }

    // Parse + plan throw invalid_input / unsupported_node before any run row.
    const graph = parseWorkflowGraph(project.workflowJson);
    planExecution(graph);

    const keys = input.providerKeys ?? {};
    assertProviderKeys(graph, makeRequestKeyResolver(keys));

    const run = await createWorkflowRun({
      workspaceId,
      projectId: input.projectId,
      userId,
      inputOverrides: input.inputOverrides ?? null,
      progress: initialProgress(graph),
    });

    scheduleBackground(() =>
      executeRunInBackground({
        runId: run.id,
        workspaceId,
        projectId: input.projectId,
        userId,
        keys,
        graph,
      }),
    );

    return { runId: run.id, status: run.status };
  },
};
