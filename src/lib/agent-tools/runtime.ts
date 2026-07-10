import type { z } from "zod";

import { ToolError } from "./errors";
import type { ToolContext, ToolDefinition } from "./types";

function describeIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.join(".");
      return path ? `${path}: ${issue.message}` : issue.message;
    })
    .join("; ");
}

/**
 * Execute a tool definition end-to-end — the single seam every adapter calls.
 *
 * Order matters and is part of the contract:
 *  1. Validate input against the tool's Zod schema (`invalid_input`).
 *  2. Enforce the tool's required permission against the resolved, already
 *     workspace-scoped session (`forbidden`). Authorization to *reach* the
 *     workspace happens earlier in the adapter; this is the per-tool check.
 *  3. Run the handler, wrapping any non-ToolError throw as `internal` while
 *     letting handler-raised ToolErrors (e.g. `not_found`) pass through.
 *  4. Validate the handler's output against its schema (`invalid_output`), so a
 *     schema-valid response is guaranteed to every surface.
 */
export async function runTool<
  InputSchema extends z.ZodTypeAny,
  OutputSchema extends z.ZodTypeAny,
>(
  definition: ToolDefinition<InputSchema, OutputSchema>,
  rawInput: unknown,
  ctx: ToolContext,
): Promise<z.infer<OutputSchema>> {
  const parsedInput = definition.inputSchema.safeParse(rawInput ?? {});
  if (!parsedInput.success) {
    throw new ToolError({
      code: "invalid_input",
      message: `Invalid arguments for '${definition.name}': ${describeIssues(
        parsedInput.error,
      )}`,
      fix: "Adjust the arguments to match the tool's input schema.",
    });
  }

  if (!ctx.session.permissions.includes(definition.requiredPermission)) {
    throw new ToolError({
      code: "forbidden",
      message: `The token's workspace role does not grant '${definition.requiredPermission}', required by '${definition.name}'.`,
      fix: "Use a token for a workspace where your role grants this permission, or ask an owner/admin to grant it.",
    });
  }

  let output: z.infer<OutputSchema>;
  try {
    output = await definition.handler(parsedInput.data, ctx);
  } catch (error) {
    if (error instanceof ToolError) {
      throw error;
    }
    throw new ToolError({
      code: "internal",
      message: error instanceof Error ? error.message : "Tool handler failed.",
      fix: "Retry the request; if it persists, the database or an upstream service may be unavailable.",
    });
  }

  const parsedOutput = definition.outputSchema.safeParse(output);
  if (!parsedOutput.success) {
    throw new ToolError({
      code: "invalid_output",
      message: `Tool '${definition.name}' returned data that failed its output schema: ${describeIssues(
        parsedOutput.error,
      )}`,
      fix: "This is a server-side bug; please report it with the tool name.",
    });
  }

  return parsedOutput.data;
}
